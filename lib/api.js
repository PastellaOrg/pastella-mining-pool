/**
 * Cryptonote Node.JS Pool
 * https://github.com/dvandal/cryptonote-nodejs-pool
 *
 * Pool API
 **/

// Load required modules
let fs = require('fs');
let http = require('http');
let https = require('https');
let url = require("url");
let async = require('async');

let apiInterfaces = require('./apiInterfaces.js')(config.daemon, config.wallet);
let authSid = Math.round(Math.random() * 10000000000) + '' + Math.round(Math.random() * 10000000000);

let charts = require('./charts.js');
let market = require('./market.js');
let utils = require('./utils.js');

// Initialize log system
let logSystem = 'api';
require('./exceptionWriter.js')(logSystem);

// Data storage variables used for live statistics
let currentStats = {};
let minerStats = {};
let minersHashrate = {};

let liveConnections = {};
let addressConnections = {};

/**
 * Handle server requests
 **/
function handleServerRequest (request, response) {
	let urlParts = url.parse(request.url, true);

	switch (urlParts.pathname) {
		// Pool statistics
		case '/stats':
			handleStats(urlParts, request, response);
			break;
		case '/live_stats':
			response.writeHead(200, {
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'no-cache',
				'Content-Type': 'application/json',
				'Connection': 'keep-alive'
			});

			let address = urlParts.query.address ? urlParts.query.address : 'undefined';
			let uid = Math.random().toString();
			let key = address + ':' + uid;

			response.on("finish", function () {
				delete liveConnections[key];
			});
			response.on("close", function () {
				delete liveConnections[key];
			});

			liveConnections[key] = response;
			break;

			// Worker statistics
		case '/stats_address':
			handleMinerStats(urlParts, response);
			break;

			// Payments
		case '/get_payments':
			handleGetPayments(urlParts, response);
			break;

			// Blocks
		case '/get_blocks':
			handleGetBlocks(urlParts, response);
			break;

			// Get market prices
		case '/get_market':
			handleGetMarket(urlParts, response);
			break;

			// Top miners
		case '/get_top10miners':
			handleTopMiners(urlParts, response);
			break;

			// Miner settings
		case '/get_miner_payout_level':
			handleGetMinerPayoutLevel(urlParts, response);
			break;
		case '/set_miner_payout_level':
			handleSetMinerPayoutLevel(urlParts, response);
			break;
		case '/block_explorers':
			handleBlockExplorers(response)
			break
		case '/get_apis':
			handleGetApis(response)
			break
			// Miners/workers hashrate (used for charts)
		case '/miners_hashrate':
			if (!authorize(request, response)) {
				return;
			}
			handleGetMinersHashrate(response);
			break;
		case '/workers_hashrate':
			if (!authorize(request, response)) {
				return;
			}
			handleGetWorkersHashrate(response);
			break;

			// Pool Administration
		case '/admin_stats':
			if (!authorize(request, response))
				return;
			handleAdminStats(response);
			break;
		case '/admin_monitoring':
			if (!authorize(request, response)) {
				return;
			}
			handleAdminMonitoring(response);
			break;
		case '/admin_log':
			if (!authorize(request, response)) {
				return;
			}
			handleAdminLog(urlParts, response);
			break;
		case '/admin_users':
			if (!authorize(request, response)) {
				return;
			}
			handleAdminUsers(request, response);
			break;
		case '/admin_ports':
			if (!authorize(request, response)) {
				return;
			}
			handleAdminPorts(request, response);
			break;

			// Default response
		default:
			response.writeHead(404, {
				'Access-Control-Allow-Origin': '*'
			});
			response.end('Invalid API call');
			break;
	}
}

/**
 * Collect statistics data
 **/
function collectStats () {
	let startTime = Date.now();
	let redisFinished;
	let daemonFinished;

	let redisCommands = [
		['zremrangebyscore', `${config.coin}:hashrate`, '-inf', ''],
		['zrange', `${config.coin}:hashrate`, 0, -1],
		['hgetall', `${config.coin}:stats`],
		['zrange', `${config.coin}:blocks:candidates`, 0, -1, 'WITHSCORES'],
		['zrevrange', `${config.coin}:blocks:matured`, 0, config.api.blocks - 1, 'WITHSCORES'],
		['hgetall', `${config.coin}:scores:prop:roundCurrent`],
		['hgetall', `${config.coin}:stats`],
		// ['zcard', `${config.coin}:blocks:matured`],
		['zrevrange', `${config.coin}:payments:all`, 0, config.api.payments - 1, 'WITHSCORES'],
		['zcard', `${config.coin}:payments:all`],
		['keys', `${config.coin}:payments:*`],
		['hgetall', `${config.coin}:shares_actual:prop:roundCurrent`],
		['zrange', `${config.coin}:blocks:matured`, 0, -1, 'WITHSCORES']
	];

	let windowTime = (((Date.now() / 1000) - config.api.hashrateWindow) | 0).toString();
	redisCommands[0][3] = '(' + windowTime;

	async.parallel({
		health: function (callback) {
			let keys = [];
			let data = {};
			keys.push(config.coin);
			let healthCommands = [];
			healthCommands.push(['hget', `${config.coin}:status:daemon`, 'lastStatus']);
			healthCommands.push(['hget', `${config.coin}:status:wallet`, 'lastStatus']);
			healthCommands.push(['hget', `${config.coin}:status:price`, 'lastReponse']);
			/*
			            config.childPools.forEach(pool => {
			                healthCommands.push(['hmget', `${pool.coin}:status:daemon`, 'lastStatus']);
			                healthCommands.push(['hmget', `${pool.coin}:status:wallet`, 'lastStatus']); 
			                keys.push(pool.coin);

			            })
			*/
			redisClient.multi(healthCommands).exec(function (error, replies) {

					if (error) {
						data = {
							daemon: 'fail',
							wallet: 'fail',
							price: 'fail'
						}
						callback(null, data)
					}
					for (var i = 0, index = 0; i < keys.length; index += 2, i++) {
						data[keys[i]] = {
							daemon: replies[index],
							wallet: replies[index + 1],
							price: replies[index + 2]
						}

					}
					callback(null, data)
				})
		},
		pool: function (callback) {
			redisClient.multi(redisCommands).exec(function (error, replies) {
					redisFinished = Date.now();
					let dateNowSeconds = Date.now() / 1000 | 0;

					if (error) {
						log('error', logSystem, 'Error getting redis data %j', [error]);
						callback(true);
						return;
					}

					// Parse payments into structured objects
					let paymentsData = [];
					if (replies[7] && replies[7].length > 0) {
						for (let i = 0; i < replies[7].length; i += 2) {
							let paymentString = replies[7][i];
							let timestamp = parseInt(replies[7][i + 1]);
							let parts = paymentString.split(':');

							paymentsData.push({
								txHash: parts[0] || '',
								amount: parseFloat(parts[1]) || 0,
								fee: parseFloat(parts[2]) || 0,
								timestamp: timestamp,
								address: parts[5] || null // Address is 6th field if present
							});
						}
					}

					let data = {
						stats: replies[2],
						blocks: parseBlocksToObjects(replies[3].concat(replies[4]), true), // Return structured objects with FULL addresses
						totalBlocks: 0,
						totalBlocksSolo: 0,
						totalDiff: 0,
						totalDiffSolo: 0,
						totalShares: 0,
						totalSharesSolo: 0,
						payments: paymentsData,
						totalPayments: parseInt(replies[8]),
						totalMinersPaid: replies[9] && replies[9].length > 0 ? replies[9].length - 1 : 0,
						miners: 0,
						minersSolo: 0,
						workers: 0,
						workersSolo: 0,
						hashrate: 0,
						hashrateSolo: 0,
						roundScore: 0,
						roundHashes: 0
					};

					calculateBlockData(data, replies[3].concat(replies[11])); // Keep using raw strings for calculation
					minerStats = {};
					minersHashrate = {};
					minersHashrateSolo = {};
					minersHashrate = {};
					minersRewardType = {};

					let hashrates = replies[1];
					for (let i = 0; i < hashrates.length; i++) {
						let hashParts = hashrates[i].split(':');
						minersHashrate[hashParts[1]] = (minersHashrate[hashParts[1]] || 0) + parseInt(hashParts[0]);
						minersRewardType[hashParts[1]] = hashParts[3]
					}

					let totalShares = 0
					let totalSharesSolo = 0

					for (let miner in minersHashrate) {
						if (minersRewardType[miner] === 'prop') {
							if (miner.indexOf('~') !== -1) {
								data.workers++;
								totalShares += minersHashrate[miner];
							} else {
								data.miners++;
							}
						} else if (minersRewardType[miner] === 'solo') {
							if (miner.indexOf('~') !== -1) {
								data.workersSolo++;
								totalSharesSolo += minersHashrate[miner];
							} else {
								data.minersSolo++;
							}
						}
						minersHashrate[miner] = Math.round(minersHashrate[miner] / config.api.hashrateWindow);
						if (!minerStats[miner]) {
							minerStats[miner] = {};
						}
						minerStats[miner]['hashrate'] = minersHashrate[miner];
					}


					data.hashrate = Math.round(totalShares / config.api.hashrateWindow);
					data.hashrateSolo = Math.round(totalSharesSolo / config.api.hashrateWindow);
					data.roundScore = 0;

					if (replies[5]) {
						for (let miner in replies[5]) {
							let roundScore = parseFloat(replies[5][miner]);

							data.roundScore += roundScore;

							if (!minerStats[miner]) {
								minerStats[miner] = {};
							}
							minerStats[miner]['roundScore'] = roundScore;
						}
					}

					data.roundHashes = 0;

					if (replies[10]) {
						for (let miner in replies[10]) {
							let roundHashes = parseInt(replies[10][miner])
							data.roundHashes += roundHashes;

							if (!minerStats[miner]) {
								minerStats[miner] = {};
							}
							minerStats[miner]['roundHashes'] = roundHashes;
						}
					}

					if (replies[6]) {
						if (!replies[6].lastBlockFound || parseInt(replies[6].lastBlockFound) < parseInt(replies[6].lastBlockFoundprop)) {
							data.lastBlockFound = replies[6].lastBlockFoundprop;
						} else {
							data.lastBlockFound = replies[6].lastBlockFound
						}

						if (replies[6].lastBlockFoundsolo) {
							data.lastBlockFoundSolo = replies[6].lastBlockFoundsolo;
						}
					}

					callback(null, data);
				});
		},
		lastblock: function (callback) {
			getLastBlockData(function (error, data) {
				daemonFinished = Date.now();
				callback(error, data);
			});
		},
		network: function (callback) {
			getNetworkData(function (error, data) {
				daemonFinished = Date.now();
				callback(error, data);
			});
		},
		config: function (callback) {
			callback(null, {
				poolHost: config.poolHost || '',
				ports: getPublicPorts(config.poolServer.ports),
				cnAlgorithm: config.cnAlgorithm || 'cryptonight',
				cnVariant: config.cnVariant || 0,
				cnBlobType: config.cnBlobType || 0,
				hashrateWindow: config.api.hashrateWindow,
				fee: config.blockUnlocker.poolFee || 0,
                		soloFee: config.blockUnlocker.soloFee >= 0 ? config.blockUnlocker.soloFee : (config.blockUnlocker.poolFee > 0 ? config.blockUnlocker.poolFee : 0),
				networkFee: config.blockUnlocker.networkFee || 0,
				coin: config.coin,
				coinUnits: config.coinUnits,
				coinDecimalPlaces: config.coinDecimalPlaces || 12, // config.coinUnits.toString().length - 1,
				coinDifficultyTarget: config.coinDifficultyTarget,
				symbol: config.symbol,
				depth: config.blockUnlocker.depth,
				finderReward: config.blockUnlocker.finderReward || 0,
				donation: donations,
				version: version,
				paymentsInterval: config.payments.interval,
				minPaymentThreshold: config.payments.minPayment,
				maxPaymentThreshold: config.payments.maxPayment || null,
				transferFee: config.payments.transferFee,
				denominationUnit: config.payments.denomination,
				slushMiningEnabled: config.poolServer.slushMining.enabled,
				weight: config.poolServer.slushMining.weight,
				priceSource: config.prices ? config.prices.source : 'cryptonator',
				priceCurrency: config.prices ? config.prices.currency : 'USD',
				paymentIdSeparator: config.poolServer.paymentId && config.poolServer.paymentId.addressSeparator ? config.poolServer.paymentId.addressSeparator : ".",
				fixedDiffEnabled: config.poolServer.fixedDiff.enabled,
				fixedDiffSeparator: config.poolServer.fixedDiff.addressSeparator,
				blocksChartEnabled: (config.charts.blocks && config.charts.blocks.enabled),
				blocksChartDays: config.charts.blocks && config.charts.blocks.days ? config.charts.blocks.days : null
			});
		},
		charts: function (callback) {
			// Get enabled charts data
			charts.getPoolChartsData(function (error, data) {
				if (error) {
					callback(error, data);
					return;
				}

				// Blocks chart
				if (!config.charts.blocks || !config.charts.blocks.enabled || !config.charts.blocks.days) {
					callback(error, data);
					return;
				}

				let chartDays = config.charts.blocks.days;

				let beginAtTimestamp = (Date.now() / 1000) - (chartDays * 86400);
				let beginAtDate = new Date(beginAtTimestamp * 1000);
				if (chartDays > 1) {
					beginAtDate = new Date(beginAtDate.getFullYear(), beginAtDate.getMonth(), beginAtDate.getDate(), 0, 0, 0, 0);
					beginAtTimestamp = beginAtDate / 1000 | 0;
				}

				let blocksCount = {};
				let blocksCountSolo = {};
				if (chartDays === 1) {
					for (let h = 0; h <= 24; h++) {
						let date = utils.dateFormat(new Date((beginAtTimestamp + (h * 60 * 60)) * 1000), 'yyyy-mm-dd HH:00');
						blocksCount[date] = 0;
						blocksCountSolo[date] = 0
					}
				} else {
					for (let d = 0; d <= chartDays; d++) {
						let date = utils.dateFormat(new Date((beginAtTimestamp + (d * 86400)) * 1000), 'yyyy-mm-dd');
						blocksCount[date] = 0;
						blocksCountSolo[date] = 0
					}
				}

				redisClient.zrevrange(config.coin + ':blocks:matured', 0, -1, 'WITHSCORES', function (err, result) {
					for (let i = 0; i < result.length; i++) {
						let block = result[i].split(':');
						if (block[0] === 'prop' || block[0] === 'solo') {
							let blockTimestamp = block[3];
							if (blockTimestamp < beginAtTimestamp) {
								continue;
							}
							let date = utils.dateFormat(new Date(blockTimestamp * 1000), 'yyyy-mm-dd');
							if (chartDays === 1) utils.dateFormat(new Date(blockTimestamp * 1000), 'yyyy-mm-dd HH:00');
							if (block[0] === 'prop') {
								if (!blocksCount[date]) blocksCount[date] = 0;
								blocksCount[date]++;
								continue
							}
							if (block[0] === 'solo') {
								if (!blocksCountSolo[date]) blocksCountSolo[date] = 0;
								blocksCountSolo[date]++;
							}
						} else {
							if (block[5]) {
								let blockTimestamp = block[1];
								if (blockTimestamp < beginAtTimestamp) {
									continue;
								}
								let date = utils.dateFormat(new Date(blockTimestamp * 1000), 'yyyy-mm-dd');
								if (chartDays === 1) utils.dateFormat(new Date(blockTimestamp * 1000), 'yyyy-mm-dd HH:00');
								if (!blocksCount[date]) blocksCount[date] = 0;
								blocksCount[date]++;
							}
						}
					}
					data.blocks = blocksCount;
					data.blocksSolo = blocksCountSolo;
					callback(error, data);
				});
			});
		}
	}, function (error, results) {
		if (error) {
			log('error', logSystem, 'Error collecting all stats');
		} else {
			currentStats = results;
			broadcastLiveStats();
			broadcastFinished = Date.now();
		}

		setTimeout(collectStats, config.api.updateInterval * 1000);
	});

}

/**
 * Parse blocks into structured objects with all details
 * @param {Array} blocksData - Array of alternating [blockString, height, blockString, height, ...]
 * @param {Boolean} includeFullAddress - Whether to include full miner address (always true now for transparency)
 * @returns {Array} Array of structured block objects
 */
function parseBlocksToObjects(blocksData, includeFullAddress = true) {
	let blocks = [];

	for (let i = 0; i < blocksData.length; i += 2) {
		let blockString = blocksData[i];
		let height = parseInt(blocksData[i + 1]);
		let parts = blockString.split(':');

		// Skip invalid blocks
		if (parts.length < 2) continue;

		// Calculate effort: shares / difficulty * 100
		let shares = parseInt(parts[5]) || 0;
		let difficulty = parseInt(parts[4]) || 0;
		let effort = difficulty > 0 ? (shares / difficulty * 100) : 0;

		let block = {
			height: height,
			type: parts[0], // 'prop' or 'solo'
			miner: parts[1] || '',
			hash: parts[2] || '',
			timestamp: parseInt(parts[3]) || 0,
			difficulty: difficulty,
			shares: shares,
			effort: Math.round(effort * 100) / 100, // Round to 2 decimal places
			status: 'pending',
			reward: 0
		};

		// Determine block status and reward based on parts length
		// New format with minerScore (10 parts for matured): type:miner:hash:timestamp:difficulty:shares:score:minerScore:orphaned:reward
		if (parts.length >= 10) {
			let orphaned = parts[8];
			block.status = (orphaned === 'true') ? 'orphaned' : 'confirmed';
			block.reward = parseFloat(parts[9]) || 0;
			block.score = parseFloat(parts[6]) || 0;
			block.minerScore = parseFloat(parts[7]) || 0;
		}
		// For 8-part blocks, we need to determine if it's a candidate or matured block
		// Candidate: type:miner:hash:timestamp:difficulty:shares:score:minerScore
		// Matured (old format): type:miner:hash:timestamp:difficulty:shares:score:orphaned:reward
		else if (parts.length === 8) {
			// Check if parts[6] is 'true'/'false' (orphaned flag) or a number (score)
			let part6Lower = parts[6].toLowerCase();
			let part7AsFloat = parseFloat(parts[7]);

			if (part6Lower === 'true' || part6Lower === 'false') {
				// Old matured format: parts[6] is orphaned, parts[7] is reward
				let orphaned = parts[6];
				block.status = (orphaned === 'true') ? 'orphaned' : 'confirmed';
				block.reward = part7AsFloat || 0;
				block.score = parseFloat(parts[6]) || 0;
				block.minerScore = shares;
			} else {
				// Candidate format: parts[6] is score, parts[7] is minerScore, no orphaned/reward yet
				block.status = 'pending';
				block.reward = 0; // No reward yet for pending blocks
				block.score = parseFloat(parts[6]) || 0;
				block.minerScore = part7AsFloat || 0;
			}
		}
		// Candidate blocks (7 parts): type:miner:hash:timestamp:difficulty:shares:score
		else if (parts.length === 7) {
			block.status = 'pending';
			block.reward = 0; // No reward yet
			block.score = parseFloat(parts[6]) || 0;
			block.minerScore = shares;
		}
		// Candidate blocks (6 or fewer parts - very old format)
		else if (parts.length === 6) {
			block.status = 'pending';
			block.reward = 0;
			block.score = shares;
			block.minerScore = shares;
		}

		blocks.push(block);
	}

	// Sort blocks by height in descending order (highest first)
	blocks.sort((a, b) => b.height - a.height);

	return blocks;
}

function truncateMinerAddress (blocks) {
	for (let i = 0; i < blocks.length; i++) {
		let block = blocks[i].split(':');
		if (block[0] === 'solo' || block[0] === 'prop') {
			block[1] = `${block[1].substring(0,7)}...${block[1].substring(block[1].length-7)}`;
			blocks[i] = block.join(':');
		}
	}
	return blocks
}

/**
 *  Calculate the Diff, shares and totalblocks
 **/
function calculateBlockData (data, blocks) {
	for (let i = 0; i < blocks.length; i++) {
		let block = blocks[i].split(':');
		if (block[0] === 'solo') {
			data.totalDiffSolo += parseInt(block[4]);
			data.totalSharesSolo += parseInt(block[5]);
			data.totalBlocksSolo += 1;
		} else if (block[0] === 'prop') {
			data.totalDiff += parseInt(block[4]);
			data.totalShares += parseInt(block[5]);
			data.totalBlocks += 1;
		} else {
			if (block[5]) {
				data.totalDiff += parseInt(block[2]);
				data.totalShares += parseInt(block[3]);
				data.totalBlocks += 1;
			}
		}
	}
}

/**
 * Get Network data
 **/
let networkDataRpcMode = 'get_info';

function getNetworkData (callback, rpcMode) {
	if (!rpcMode) rpcMode = networkDataRpcMode;

	// Try get_info RPC method first if available (not all coins support it)
	if (rpcMode === 'get_info') {
		apiInterfaces.rpcDaemon('get_info', {}, function (error, reply) {
			if (error || !reply) {
				getNetworkData(callback, 'getlastblockheader');
				return;
			} else {
				networkDataRpcMode = 'get_info';

				callback(null, {
					difficulty: reply.difficulty,
					height: reply.height
				});
			}
		});
	}

	// Else fallback to getlastblockheader
	else {
		apiInterfaces.rpcDaemon('getlastblockheader', {}, function (error, reply) {
			if (error) {
				log('error', logSystem, 'Error getting network data %j', [error]);
				callback(true);
				return;
			} else {
				networkDataRpcMode = 'getlastblockheader';

				let blockHeader = reply.block_header;
				callback(null, {
					difficulty: blockHeader.difficulty,
					height: blockHeader.height + 1
				});
			}
		});
	}
}

/**
 * Get Last Block data
 **/
function getLastBlockData (callback) {
	apiInterfaces.rpcDaemon('getlastblockheader', {}, function (error, reply) {
		if (error) {
			log('error', logSystem, 'Error getting last block data %j', [error]);
			callback(true);
			return;
		}
		let blockHeader = reply.block_header;
		if (config.blockUnlocker.useFirstVout) {
			apiInterfaces.rpcDaemon('f_block_json', {
				hash: blockHeader.hash
			}, function (error, result) {
				if (error) {
					log('error', logSystem, 'Error getting last block details: %j', [error]);
					callback(true);
					return;
				}
				
				apiInterfaces.rpcDaemon('f_transaction_json', {
					hash: result.block.transactions[0].hash
				}, function (rewardError, rewardResult) {
					let vout = rewardResult.tx.vout;
					if (!vout.length) {
						log('error', logSystem, 'Error: tx at height %s has no vouts!', [blockHeight]);
						mapCback(true);
						return;
					}

					let voutAmount = 0;
					// Check if fee amount included in block
					if(vout.length == 3) {
						voutAmount = vout[0].amount;
					} else if(vout.length == 4) {
						voutAmount = vout[0].amount;
						voutAmount += vout[1].amount;
					}
				
					callback(null, {
						difficulty: blockHeader.difficulty,
						height: blockHeader.height,
						timestamp: blockHeader.timestamp,
						reward: voutAmount,
						hash: blockHeader.hash
					});
				});
			});
			return;
		}
		callback(null, {
			difficulty: blockHeader.difficulty,
			height: blockHeader.height,
			timestamp: blockHeader.timestamp,
			reward: blockHeader.reward,
			hash: blockHeader.hash
		});
	});
}

function handleGetApis (callback) {
	let apis = {};
	config.childPools.forEach(pool => {
		if (pool.enabled)
			apis[pool.coin] = {
				api: pool.api
			}
	})
	callback(apis)
}

/**
 * Broadcast live statistics
 **/
function broadcastLiveStats () {
	// Live statistics
	let processAddresses = {};
	for (let key in liveConnections) {
		let addrOffset = key.indexOf(':');
		let address = key.substr(0, addrOffset);
		if (!processAddresses[address]) { 
			processAddresses[address] = [];
		}
		processAddresses[address].push(liveConnections[key]);
	}

	for (let address in processAddresses) {
		let data = currentStats;

		data.miner = {};
		if (address && minerStats[address]) {
			data.miner = minerStats[address];
		}

		let destinations = processAddresses[address];
		sendLiveStats(data, destinations);
	}

	// Workers Statistics
	processAddresses = {};
	for (let key in addressConnections) {
		let addrOffset = key.indexOf(':');
		let address = key.substr(0, addrOffset);
		if (!processAddresses[address]) { 
			processAddresses[address] = [];
		}
		processAddresses[address].push(addressConnections[key]);
	}

	for (let address in processAddresses) {
		broadcastWorkerStats(address, processAddresses[address]);
	}
}

/**
 * Takes a chart data JSON string and uses it to compute the average over the past hour, 6 hours,
 * and 24 hours.  Returns [AVG1, AVG6, AVG24].
 **/
function extractAverageHashrates (chartdata) {
	let now = new Date() / 1000 | 0;

	let sums = [0, 0, 0]; // 1h, 6h, 24h
	let counts = [0, 0, 0];

	let sets = chartdata ? JSON.parse(chartdata) : []; // [time, avgValue, updateCount]
	for (let j in sets) {
		let hr = sets[j][1];
		if (now - sets[j][0] <= 1 * 60 * 60) {
			sums[0] += hr;
			counts[0]++;
		}
		if (now - sets[j][0] <= 6 * 60 * 60) {
			sums[1] += hr;
			counts[1]++;
		}
		if (now - sets[j][0] <= 24 * 60 * 60) {
			sums[2] += hr;
			counts[2]++;
		}
	}

	return [sums[0] * 1.0 / (counts[0] || 1), sums[1] * 1.0 / (counts[1] || 1), sums[2] * 1.0 / (counts[2] || 1)];
}

/**
 * Broadcast worker statistics
 **/
function broadcastWorkerStats (address, destinations) {
	let redisCommands = [
		['hgetall', `${config.coin}:workers:${address}`],
		['zrevrange', `${config.coin}:payments:${address}`, 0, config.api.payments - 1, 'WITHSCORES'],
		['keys', `${config.coin}:unique_workers:${address}~*`],
		['get', `${config.coin}:charts:hashrate:${address}`],
		['zrevrangebyscore', `${config.coin}:blocks:matured`, '+inf', '-inf', 'WITHSCORES', 'LIMIT', 0, config.api.blocks]
	];
	redisClient.multi(redisCommands).exec(function (error, replies) {
			if (error || !replies || !replies[0]) {
				sendLiveStats({
					error: 'Not found'
				}, destinations);
				return;
			}

			let stats = replies[0];
			stats.hashrate = minerStats[address] && minerStats[address]['hashrate'] ? minerStats[address]['hashrate'] : 0;
			stats.roundScore = minerStats[address] && minerStats[address]['roundScore'] ? minerStats[address]['roundScore'] : 0;
			stats.roundHashes = minerStats[address] && minerStats[address]['roundHashes'] ? minerStats[address]['roundHashes'] : 0;
			if (replies[3]) {
				let hr_avg = extractAverageHashrates(replies[3]);
				stats.hashrate_1h = hr_avg[0];
				stats.hashrate_6h = hr_avg[1];
				stats.hashrate_24h = hr_avg[2];
			}

			// Parse payments into structured objects
			let paymentsData = [];
			if (replies[1]) {
				for (let i = 0; i < replies[1].length; i += 2) {
					let paymentString = replies[1][i];
					let timestamp = parseInt(replies[1][i + 1]);
					let parts = paymentString.split(':');

					paymentsData.push({
						txHash: parts[0] || '',
						amount: parseFloat(parts[1]) || 0,
						fee: parseFloat(parts[2]) || 0,
						timestamp: timestamp
					});
				}
			}

			let blocksData = replies[4] || [];

			// Filter blocks to only include those mined by this address
			let minerBlocks = [];
			if (blocksData && blocksData.length > 0) {
				for (let i = 0; i < blocksData.length; i += 2) {
					let blockString = blocksData[i];
					let height = parseInt(blocksData[i + 1]);
					let parts = blockString.split(':');

					if (parts.length >= 2 && parts[1] === address) {
						// This block was mined by this address
						// Block format: prop:miner:hash:timestamp:difficulty:totalShares:score:minerScore:orphaned:reward
						let totalScore = parseFloat(parts[6]) || 0;
						let minerScore = parts.length >= 8 ? parseFloat(parts[7]) || 0 : totalScore; // Default to total for backward compatibility
						let totalShares = parseInt(parts[5]) || 0;
						let blockReward = parts.length >= 10 ? parseFloat(parts[9]) || 0 : 0;

						let blockData = {
							height: height,
							type: parts[0],
							miner: parts[1],
							hash: parts[2] || '',
							timestamp: parseInt(parts[3]) || 0,
							difficulty: parseInt(parts[4]) || 0,
							totalShares: totalShares,
							totalScore: totalScore,
							minerScore: minerScore,
							reward: blockReward,
							status: parts.length >= 9 ? (parts[8] === 'true' ? 'orphaned' : 'confirmed') : 'pending'
						};

						// Calculate percentage and reward
						let percentage = totalScore > 0 ? (minerScore / totalScore) * 100 : 0;

						// Apply pool fee (1%)
						let poolFee = config.blockUnlocker && config.blockUnlocker.poolFee ? config.blockUnlocker.poolFee : 1;
						let rewardAfterFee = blockReward * (1 - poolFee / 100);
						let minerReward = rewardAfterFee * (percentage / 100);

						blockData.sharePercent = percentage;
						blockData.minerReward = minerReward;

						minerBlocks.push(blockData);
					}
				}
			}

			let workersData = [];
			for (let j = 0; j < replies[2].length; j++) {
					let key = replies[2][j];
					let keyParts = key.split(':');
					let miner = keyParts[2];
					if (miner.indexOf('~') !== -1) {
						let workerName = miner.substr(miner.indexOf('~') + 1, miner.length);
						let workerData = {
							name: workerName,
							hashrate: minerStats[miner] && minerStats[miner]['hashrate'] ? minerStats[miner]['hashrate'] : 0
						};
						workersData.push(workerData);
					}
				}

				charts.getUserChartsData(address, paymentsData, function (error, chartsData) {
					let redisCommands = [];
					for (let i in workersData) {
						redisCommands.push(['hgetall', `${config.coin}:unique_workers:${address}~${workersData[i].name}`]);
						redisCommands.push(['get', `${config.coin}:charts:worker_hashrate:${address}~${ workersData[i].name}`]);
					}
					redisClient.multi(redisCommands).exec(function (error, workerReplies) {
						for (let i in workersData) {
							let wi = 2 * i;
							let hi = wi + 1
							if (workerReplies[wi]) {
								workersData[i].lastShare = workerReplies[wi]['lastShare'] ? parseInt(workerReplies[wi]['lastShare']) : 0;
								workersData[i].hashes = workerReplies[wi]['hashes'] ? parseInt(workerReplies[wi]['hashes']) : 0;
								workersData[i].type = workerReplies[wi]['rewardType'] || 'prop';
							}
							if (workerReplies[hi]) {
								let avgs = extractAverageHashrates(workerReplies[hi]);
								workersData[i]['hashrate_1h'] = avgs[0];
								workersData[i]['hashrate_6h'] = avgs[1];
								workersData[i]['hashrate_24h'] = avgs[2];
							}
						}

						let data = {
							stats: stats,
							payments: paymentsData,
							blocks: minerBlocks,
							charts: chartsData,
							workers: workersData
						};
						sendLiveStats(data, destinations);
					});
				});
		});
}

/**
 * Send live statistics to specified destinations
 **/
function sendLiveStats (data, destinations) {
	if (!destinations) { 
		return;
	}

	let dataJSON = JSON.stringify(data);
	for (let i in destinations) {
		destinations[i].end(dataJSON);
	}
}

/**
 * Return pool statistics
 **/
function handleStats (urlParts, request, response) {
	let data = currentStats;

	data.miner = {};
	let address = urlParts.query.address;
	if (address && minerStats[address]) {
		data.miner = minerStats[address];
	}

	let dataJSON = JSON.stringify(data);

	response.writeHead("200", {
		'Access-Control-Allow-Origin': '*',
		'Cache-Control': 'no-cache',
		'Content-Type': 'application/json',
		'Content-Length': Buffer.byteLength(dataJSON, 'utf8')
	});
	response.end(dataJSON);
}

/**
 * Return miner (worker) statistics
 **/
function handleMinerStats (urlParts, response) {
	let address = urlParts.query.address;
	let longpoll = (urlParts.query.longpoll === 'true');

	if (longpoll) {
		response.writeHead(200, {
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'no-cache',
			'Content-Type': 'application/json',
			'Connection': 'keep-alive'
		});

		redisClient.exists(`${config.coin}:workers:${address}`, function (error, result) {
			if (!result) {
				response.end(JSON.stringify({
					error: 'Not found'
				}));
				return;
			}

			let address = urlParts.query.address;
			let uid = Math.random().toString();
			let key = address + ':' + uid;
			response.on("finish", function () {
				delete addressConnections[key];
			});
			response.on("close", function () {
				delete addressConnections[key];
			});
			addressConnections[key] = response;
		});
	} else {
		redisClient.multi([
				['hgetall', `${config.coin}:workers:${address}`],
				['zrevrange', `${config.coin}:payments:${address}`, 0, config.api.payments - 1, 'WITHSCORES'],
				['keys', `${config.coin}:unique_workers:${address}~*`],
				['get', `${config.coin}:charts:hashrate:${address}`],
				['zrevrangebyscore', `${config.coin}:blocks:matured`, '+inf', '-inf', 'WITHSCORES', 'LIMIT', 0, config.api.blocks],
				['zrange', `${config.coin}:blocks:candidates`, 0, -1, 'WITHSCORES'],
				['hgetall', `${config.coin}:scores:prop:roundCurrent`],
				['hgetall', `${config.coin}:scores:solo:roundCurrent`]
			]).exec(function (error, replies) {
				if (error || !replies[0]) {
					let dataJSON = JSON.stringify({
						error: 'Not found'
					});
					response.writeHead("200", {
						'Access-Control-Allow-Origin': '*',
						'Cache-Control': 'no-cache',
						'Content-Type': 'application/json',
						'Content-Length': Buffer.byteLength(dataJSON, 'utf8')
					});
					response.end(dataJSON);
					return;
				}

				let stats = replies[0];
				stats.hashrate = minerStats[address] && minerStats[address]['hashrate'] ? minerStats[address]['hashrate'] : 0;
				stats.roundScore = minerStats[address] && minerStats[address]['roundScore'] ? minerStats[address]['roundScore'] : 0;
				stats.roundHashes = minerStats[address] && minerStats[address]['roundHashes'] ? minerStats[address]['roundHashes'] : 0;
				if (replies[3]) {
					let hr_avg = extractAverageHashrates(replies[3]);
					stats.hashrate_1h = hr_avg[0];
					stats.hashrate_6h = hr_avg[1];
					stats.hashrate_24h = hr_avg[2];
				}

				// Calculate miner's percentage of current round
				let propScores = replies[6] || {};
				let soloScores = replies[7] || {};
				let totalRoundScore = 0;

				// Sum all scores in the round
				for (let miner in propScores) {
					totalRoundScore += parseFloat(propScores[miner]) || 0;
				}
				for (let miner in soloScores) {
					totalRoundScore += parseFloat(soloScores[miner]) || 0;
				}

				// Calculate percentage
				stats.roundSharePercent = totalRoundScore > 0 ? (stats.roundScore / totalRoundScore) * 100 : 0;

				// Parse payments into structured objects
				let paymentsData = [];
				if (replies[1]) {
					for (let i = 0; i < replies[1].length; i += 2) {
						let paymentString = replies[1][i];
						let timestamp = parseInt(replies[1][i + 1]);
						let parts = paymentString.split(':');

						paymentsData.push({
							txHash: parts[0] || '',
							amount: parseFloat(parts[1]) || 0,
							fee: parseFloat(parts[2]) || 0,
							timestamp: timestamp
						});
					}
				}

				let maturedBlocksData = replies[4] || [];
				let candidateBlocksData = replies[5] || [];

				// Combine matured and candidate blocks
				let blocksData = [...maturedBlocksData, ...candidateBlocksData];

				// Get unique block heights to query participants
				let blockHeights = [];
				for (let i = 1; i < blocksData.length; i += 2) {
					blockHeights.push(parseInt(blocksData[i]));
				}

				// Query participants for all blocks
				redisClient.hmget(`${config.coin}:blocks:participants`, blockHeights, function (err, participantsData) {
					if (err) {
						// If participants query fails, return empty blocks array
						processWorkersAndSend([]);
						return;
					}

					// Filter blocks to only include those this miner participated in
					let minerBlocks = [];
					if (blocksData && blocksData.length > 0) {
						for (let i = 0; i < blocksData.length; i += 2) {
							let blockString = blocksData[i];
							let height = blocksData[i + 1] !== undefined ? parseInt(blocksData[i + 1]) : Date.now();
							let parts = blockString.split(':');

							if (parts.length >= 2) {
								let blockType = parts[0];
								let blockFinder = parts[1];
								let participantsData_str = participantsData[i / 2] || `${blockFinder}:0`; // Default to finder with 0 score if no participants data

								// Parse participants data: "address1:score1,address2:score2,..."
								let participantMap = {};
								participantsData_str.split(',').forEach(p => {
									let [addr, score] = p.split(':');
									if (addr && score !== undefined) {
										participantMap[addr] = parseFloat(score);
									}
								});

								// Check if this miner participated in this block
								// For solo: must be the finder
								// For prop/pool: must be in participants map
								if (blockType === 'solo') {
									if (blockFinder !== address) {
										continue; // Skip solo blocks this miner didn't find
									}
								} else {
									// For prop/pool blocks, check if miner is in participants
									if (!(address in participantMap)) {
										continue; // Skip blocks this miner didn't participate in
									}
								}

							let totalShares = parseInt(parts[5]) || 0;
							let score = parseFloat(parts[6]) || 0;
							let finderScore = parts.length >= 8 ? parseFloat(parts[7]) || 0 : score;
							let blockReward = parts.length >= 10 ? parseFloat(parts[9]) || 0 : 0;
							let isPending = parts.length < 9;
							let isOrphaned = !isPending && parts[8] === 'true';

							// Get this miner's score from the participants map
							let minerScore = participantMap[address] || 0;

							let blockData = {
								height: height,
								type: blockType,
								miner: parts[1],
								hash: parts[2] || '',
								timestamp: parseInt(parts[3]) || 0,
								difficulty: parseInt(parts[4]) || 0,
								totalShares: totalShares,
								totalScore: score,
								minerScore: minerScore,
								reward: blockReward,
								status: isPending ? 'pending' : (isOrphaned ? 'orphaned' : 'confirmed')
							};

							// Calculate percentage and reward based on block type
							let percentage = 0;
							let calculatedMinerReward = 0;

							if (blockType === 'solo') {
								// Solo miners get 100% of the reward
								percentage = 100;
								// Apply pool fee
								let poolFee = config.blockUnlocker && config.blockUnlocker.soloFee >= 0 ? config.blockUnlocker.soloFee : (config.blockUnlocker.poolFee || 0);
								if (blockReward > 0) {
									let rewardAfterFee = blockReward * (1 - poolFee / 100);
									calculatedMinerReward = rewardAfterFee;
								}
							} else {
								// PPLNS miners get proportional share based on their score
								percentage = score > 0 ? (minerScore / score) * 100 : 0;
								// Apply pool fee and finder reward
								let poolFee = config.blockUnlocker && config.blockUnlocker.poolFee ? config.blockUnlocker.poolFee : 1;
								let finderReward = config.blockUnlocker && config.blockUnlocker.finderReward ? config.blockUnlocker.finderReward : 0;
								if (blockReward > 0) {
									let rewardAfterFees = blockReward * (1 - (poolFee + finderReward) / 100);
									calculatedMinerReward = rewardAfterFees * (percentage / 100);
								}
							}

							blockData.sharePercent = percentage;
							blockData.minerReward = calculatedMinerReward;

							minerBlocks.push(blockData);
						}
						}
					}

					// Sort blocks by height descending (newest first)
					minerBlocks.sort((a, b) => b.height - a.height);

					// Continue with worker data processing
					processWorkersAndSend(minerBlocks);

				function processWorkersAndSend(minerBlocks) {
					let workersData = [];
					for (let i = 0; i < replies[2].length; i++) {
						let key = replies[2][i];
						let keyParts = key.split(':');
						let miner = keyParts[2];
						if (miner.indexOf('~') !== -1) {
							let workerName = miner.substr(miner.indexOf('~') + 1, miner.length);
							let workerData = {
								name: workerName,
								hashrate: minerStats[miner] && minerStats[miner]['hashrate'] ? minerStats[miner]['hashrate'] : 0
							};
							workersData.push(workerData);
						}
					}

					charts.getUserChartsData(address, paymentsData, function (error, chartsData) {
						let redisCommands = [];
						for (let i in workersData) {
							redisCommands.push(['hgetall', `${config.coin}:unique_workers:${address}~${workersData[i].name}`]);
							redisCommands.push(['get', `${config.coin}:charts:worker_hashrate:${address}~${workersData[i].name}`]);
						}
						redisClient.multi(redisCommands).exec(function (error, workerReplies) {
							for (let i in workersData) {
								let wi = 2 * i;
								let hi = wi + 1;
								if (workerReplies[wi]) {
									workersData[i].lastShare = workerReplies[wi]['lastShare'] ? parseInt(workerReplies[wi]['lastShare']) : 0;
									workersData[i].hashes = workerReplies[wi]['hashes'] ? parseInt(workerReplies[wi]['hashes']) : 0;
									workersData[i].type = workerReplies[wi]['rewardType'] || 'prop';
								}
								if (workerReplies[hi]) {
									let avgs = extractAverageHashrates(workerReplies[hi]);
									workersData[i]['hashrate_1h'] = avgs[0];
									workersData[i]['hashrate_6h'] = avgs[1];
									workersData[i]['hashrate_24h'] = avgs[2];
								}
							}

							let data = {
								stats: stats,
								payments: paymentsData,
								blocks: minerBlocks,
								charts: chartsData,
								workers: workersData
							};

							let dataJSON = JSON.stringify(data);

							response.writeHead("200", {
								'Access-Control-Allow-Origin': '*',
								'Cache-Control': 'no-cache',
								'Content-Type': 'application/json',
								'Content-Length': Buffer.byteLength(dataJSON, 'utf8')
						});
						response.end(dataJSON);
					});
				});
				} // Close processWorkersAndSend function
			}); // Close hmget callback
		}); // Close main multi.exec
	}
}

/**
 * Return payments history
 **/
function handleGetPayments (urlParts, response) {
	let paymentKey = ':payments:all';

	if (urlParts.query.address)
		paymentKey = `:payments:${urlParts.query.address}`;

	// Parse pagination parameters
	let page = parseInt(urlParts.query.page) || 1;
	let limit = parseInt(urlParts.query.limit) || 20;
	let offset = (page - 1) * limit;

	// Get total count first
	redisClient.zcard(`${config.coin}${paymentKey}`, function (err, total) {
		if (err) {
			let data = {
				error: 'Query failed'
			};
			let reply = JSON.stringify(data);
			response.writeHead("200", {
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'no-cache',
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(reply, 'utf8')
			});
			response.end(reply);
			return;
		}

		// Calculate total pages
		let totalPages = Math.ceil(total / limit);

		// Get paginated results
		redisClient.zrevrange(
			`${config.coin}${paymentKey}`,
			offset,
			offset + limit - 1,
			'WITHSCORES',
			function (err, result) {
				if (err) {
					let data = {
						error: 'Query failed'
					};
					let reply = JSON.stringify(data);
					response.writeHead("200", {
						'Access-Control-Allow-Origin': '*',
						'Cache-Control': 'no-cache',
						'Content-Type': 'application/json',
						'Content-Length': Buffer.byteLength(reply, 'utf8')
					});
					response.end(reply);
					return;
				}

				// Parse payments into structured objects
				let payments = [];
				if (result && result.length > 0) {
					for (let i = 0; i < result.length; i += 2) {
						let paymentString = result[i];
						let timestamp = parseInt(result[i + 1]);
						let parts = paymentString.split(':');

						payments.push({
							txHash: parts[0] || '',
							amount: parseFloat(parts[1]) || 0,
							fee: parseFloat(parts[2]) || 0,
							timestamp: timestamp,
							address: parts[5] || null // Address is 6th field if present
						});
					}
				}

				let data = {
					payments: payments,
					total: total,
					page: page,
					limit: limit,
					totalPages: totalPages
				};

				let reply = JSON.stringify(data);

				response.writeHead("200", {
					'Access-Control-Allow-Origin': '*',
					'Cache-Control': 'no-cache',
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(reply, 'utf8')
				});
				response.end(reply);
			}
		);
	});
}

/**
 * Return blocks data
 **/
function handleGetBlocks (urlParts, response) {
	// Parse pagination parameters
	const page = parseInt(urlParts.query.page) || 1;
	const limit = parseInt(urlParts.query.limit) || 20;
	const offset = (page - 1) * limit;

	// Get both matured blocks and candidate blocks
	async.waterfall([
		// Get total count of matured blocks
		function (callback) {
			redisClient.zcard(`${config.coin}:blocks:matured`, function (err, count) {
				callback(err, count || 0);
			});
		},
		// Get total count of candidate blocks
		function (maturedCount, callback) {
			redisClient.zcard(`${config.coin}:blocks:candidates`, function (err, candidateCount) {
				const totalCount = (maturedCount || 0) + (candidateCount || 0);
				callback(null, { totalCount, totalCandidateCount: candidateCount || 0 });
			});
		},
		// Get candidate blocks count for this request
		function (data, callback) {
			if (page === 1) {
				// First page: get candidates first (using zrevrange for consistency)
				redisClient.zrevrange(
					`${config.coin}:blocks:candidates`,
					0,
					limit - 1,
					'WITHSCORES',
					function (err, result) {
						if (err) {
							callback(err, { ...data, candidateBlocks: [] });
						} else {
							callback(null, { ...data, candidateBlocks: result || [] });
						}
					}
				);
			} else {
				// Other pages: pass through the total candidate count
				callback(null, { ...data, candidateBlocks: [] });
			}
		},
		// Get matured blocks
		function (data, callback) {
			// Calculate how many matured blocks we need
			// Use totalCandidateCount to account for candidates consumed on page 1
			const numCandidateBlocks = data.totalCandidateCount || 0;
			let maturedOffset = offset;
			let maturedLimit = limit;

			if (page === 1) {
				// On first page, after candidates, we need fewer matured blocks
				maturedOffset = 0;
				maturedLimit = limit - numCandidateBlocks;
			} else {
				// On other pages, adjust offset to account for candidates on page 1
				maturedOffset = offset - numCandidateBlocks;
			}

			if (maturedLimit > 0) {
				// Use zrevrange (by index) instead of zrevrangebyscore to get all blocks
				redisClient.zrevrange(
					`${config.coin}:blocks:matured`,
					maturedOffset,
					maturedOffset + maturedLimit - 1,
					'WITHSCORES',
					function (err, result) {
						if (err) {
							callback(err, { ...data, maturedBlocks: [] });
						} else {
							callback(null, { ...data, maturedBlocks: result || [] });
						}
					}
				);
			} else {
				callback(null, { ...data, maturedBlocks: [] });
			}
		},
		// Combine and parse blocks
		function (data, callback) {
			const allBlocks = [...data.candidateBlocks, ...data.maturedBlocks];
			const parsedBlocks = parseBlocksToObjects(allBlocks, true); // Return objects with FULL addresses
			callback(null, { totalCount: data.totalCount, blocks: parsedBlocks });
		}
	], function (err, data) {
		let responseData;
		if (err) {
			responseData = {
				error: 'Query failed'
			};
		} else {
			responseData = {
				blocks: data.blocks,
				total: data.totalCount,
				page: page,
				limit: limit,
				totalPages: Math.ceil(data.totalCount / limit)
			};
		}

		let reply = JSON.stringify(responseData);

		response.writeHead("200", {
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'no-cache',
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(reply, 'utf8')
		});
		response.end(reply);
	});
}

/**
 * Get market exchange prices
 **/
function handleGetMarket (urlParts, response) {
	response.writeHead(200, {
		'Access-Control-Allow-Origin': '*',
		'Cache-Control': 'no-cache',
		'Content-Type': 'application/json'
	});
	response.write('\n');

	let tickers = urlParts.query["tickers[]"] || urlParts.query.tickers;
	if (!tickers || tickers === undefined) {
		response.end(JSON.stringify({
			error: 'No tickers specified.'
		}));
		return;
	}

	let exchange = urlParts.query.exchange || config.prices.source;
	if (!exchange || exchange === undefined) {
		response.end(JSON.stringify({
			error: 'No exchange specified.'
		}));
		return;
	}

	// Get market prices
	market.get(exchange, tickers, function (data) {
		response.end(JSON.stringify(data));
	});
}

function handleGetApis (response) {
	async.waterfall([
		function (callback) {
			let apis = {};
			config.childPools.forEach(pool => {
				if (pool.enabled)
					apis[pool.coin] = {
						api: pool.api
					}
			})
			callback(null, apis);
		}
	], function (error, data) {
		if (error) {
			response.end(JSON.stringify({
				error: 'Error collecting Api Information'
			}));
			return;
		}
		let reply = JSON.stringify(data);

		response.writeHead("200", {
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'no-cache',
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(reply, 'utf8')
		});
		response.end(reply);
	})
}

/**
 * Return top 10 miners
 **/
function handleBlockExplorers (response) {
	async.waterfall([
		function (callback) {
			let blockExplorers = {};
			blockExplorers[config.coin] = {
				"blockchainExplorer": config.blockchainExplorer,
				"transactionExplorer": config.transactionExplorer
			}
			config.childPools.forEach(pool => {
				if (pool.enabled)
					blockExplorers[pool.coin] = {
						"blockchainExplorer": pool.blockchainExplorer,
						"transactionExplorer": pool.transactionExplorer
					}
			})
			callback(null, blockExplorers);
		}
	], function (error, data) {
		if (error) {
			response.end(JSON.stringify({
				error: 'Error collecting Block Explorer Information'
			}));
			return;
		}
		let reply = JSON.stringify(data);

		response.writeHead("200", {
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'no-cache',
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(reply, 'utf8')
		});
		response.end(reply);
	})
}

/**
 * Return top 10 miners
 **/
function handleTopMiners (urlParts, response) {
	// Parse query parameters
	let sortBy = urlParts.query.sortBy || 'hashes'; // 'hashes' or 'hashrate'
	let limit = parseInt(urlParts.query.limit) || 10;
	let excludeInactive = urlParts.query.excludeInactive === 'true';
	// Handle decimal hours for short thresholds (like 5 minutes = 0.083 hours)
	let hours = parseFloat(urlParts.query.inactiveHours) || 24;
	let inactiveThreshold = Math.round(hours * 60 * 60); // Convert hours to seconds

	async.waterfall([
		function (callback) {
			redisClient.keys(`${config.coin}:workers:*`, callback);
		},
		function (workerKeys, callback) {
			let redisCommands = workerKeys.map(function (k) {
				return ['hmget', k, 'lastShare', 'hashes'];
			});
			redisClient.multi(redisCommands).exec(function (error, redisData) {
					let minersData = [];
					let keyParts = [];
					let address = '';
					let data = '';
					let now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
					for (let i in redisData) {
						keyParts = workerKeys[i].split(':');
						address = keyParts[keyParts.length - 1];
						data = redisData[i];
						let lastShare = data[0] ? parseInt(data[0]) : 0;
						let hashes = data[1] ? parseInt(data[1]) : 0;

						// Skip inactive miners if requested
						if (excludeInactive) {
							if (lastShare === 0) {
								// Never mined - skip
								continue;
							}
							let timeSinceLastShare = now - lastShare;
							if (timeSinceLastShare > inactiveThreshold) {
								// Inactive for too long - skip
								continue;
							}
						}

						minersData.push({
							miner: address,
							hashrate: minerStats[address] && minerStats[address]['hashrate'] ? minerStats[address]['hashrate'] : 0,
							lastShare: lastShare,
							hashes: hashes
						});
					}
					callback(null, minersData);
				});
		}
	], function (error, data) {
		if (error) {
			response.end(JSON.stringify({
				error: 'Error collecting top miners stats'
			}));
			return;
		}

		// Sort by selected field
		if (sortBy === 'hashrate') {
			data.sort(function (a, b) {
				let v1 = a.hashrate || 0;
				let v2 = b.hashrate || 0;
				if (v1 > v2) return -1;
				if (v1 < v2) return 1;
				return 0;
			});
		} else {
			// Default: sort by hashes
			data.sort(function (a, b) {
				let v1 = a.hashes || 0;
				let v2 = b.hashes || 0;
				if (v1 > v2) return -1;
				if (v1 < v2) return 1;
				return 0;
			});
		}

		// Apply limit
		data = data.slice(0, limit);

		// Wrap in object for consistency with frontend expectations
		let reply = JSON.stringify({
			miners: data,
			sortBy: sortBy,
			excludeInactive: excludeInactive,
			total: data.length
		});

		response.writeHead("200", {
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'no-cache',
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(reply, 'utf8')
		});
		response.end(reply);
	});
}

/**
 * Miner settings: minimum payout level
 **/

// Get current minimum payout level
function handleGetMinerPayoutLevel (urlParts, response) {
	response.writeHead(200, {
		'Access-Control-Allow-Origin': '*',
		'Cache-Control': 'no-cache',
		'Content-Type': 'application/json'
	});
	response.write('\n');

	let address = urlParts.query.address;

	// Check the minimal required parameters for this handle.
	if (address === undefined) {
		response.end(JSON.stringify({
			status: 'Parameters are incomplete'
		}));
		return;
	}

	// Return current miner payout level
	redisClient.hget(`${config.coin}:workers:${address}`, 'minPayoutLevel', function (error, value) {
		if (error) {
			response.end(JSON.stringify({
				status: 'Unable to get the current minimum payout level from database'
			}));
			return;
		}

		let minLevel = config.payments.minPayment / config.coinUnits;
		if (minLevel < 0) minLevel = 0;

		let maxLevel = config.payments.maxPayment ? config.payments.maxPayment / config.coinUnits : null;

		let currentLevel = value / config.coinUnits;
		if (currentLevel < minLevel) currentLevel = minLevel;
		if (maxLevel && currentLevel > maxLevel) currentLevel = maxLevel;

		response.end(JSON.stringify({
			status: 'done',
			level: currentLevel
		}));
	});
}

// Set minimum payout level
function handleSetMinerPayoutLevel (urlParts, response) {
	response.writeHead(200, {
		'Access-Control-Allow-Origin': '*',
		'Cache-Control': 'no-cache',
		'Content-Type': 'application/json'
	});
	response.write('\n');

	let address = urlParts.query.address;
	let ip = urlParts.query.ip;
	let level = urlParts.query.level;
	// Check the minimal required parameters for this handle.
	if (ip === undefined || address === undefined || level === undefined) {
		response.end(JSON.stringify({
			status: 'Parameters are incomplete'
		}));
		return;
	}

	// Do not allow wildcards in the queries.
	if (ip.indexOf('*') !== -1 || address.indexOf('*') !== -1) {
		response.end(JSON.stringify({
			status: 'Remove the wildcard from your miner address'
		}));
		return;
	}

	level = parseFloat(level);
	if (isNaN(level)) {
		response.end(JSON.stringify({
			status: 'Your minimum payout level doesn\'t look like a number'
		}));
		return;
	}

	let minLevel = config.payments.minPayment / config.coinUnits;
	if (minLevel < 0) minLevel = 0;
	let maxLevel = config.payments.maxPayment ? config.payments.maxPayment / config.coinUnits : null;
	if (level < minLevel) {
		response.end(JSON.stringify({
			status: 'The minimum payout level is ' + minLevel
		}));
		return;
	}

	if (maxLevel && level > maxLevel) {
		response.end(JSON.stringify({
			status: 'The maximum payout level is ' + maxLevel
		}));
		return;
	}

	// Only do a modification if we have seen the IP address in combination with the wallet address.
	minerSeenWithIPForAddress(address, ip, function (error, found) {
		if (!found || error) {
			response.end(JSON.stringify({
				status: 'We haven\'t seen that IP for that wallet address in our record'
			}));
			return;
		}

		let payoutLevel = level * config.coinUnits;
		redisClient.hset(config.coin + ':workers:' + address, 'minPayoutLevel', payoutLevel, function (error, value) {
			if (error) {
				response.end(JSON.stringify({
					status: 'An error occurred when updating the value in our database'
				}));
				return;
			}

			log('info', logSystem, 'Updated minimum payout level for ' + address + ' to: ' + payoutLevel);
			response.end(JSON.stringify({
				status: 'done'
			}));
		});
	});
}

/**
 * Return miners hashrate
 **/
function handleGetMinersHashrate (response) {
	let data = {};
	for (let miner in minersHashrate) {
		if (miner.indexOf('~') !== -1) continue;
		data[miner] = minersHashrate[miner];
	}

	data = {
		minersHashrate: data
	}

	let reply = JSON.stringify(data);

	response.writeHead("200", {
		'Access-Control-Allow-Origin': '*',
		'Cache-Control': 'no-cache',
		'Content-Type': 'application/json',
		'Content-Length': Buffer.byteLength(reply, 'utf8')
	});
	response.end(reply);
}

/**
 * Return workers hashrate
 **/
function handleGetWorkersHashrate (response) {
	let data = {};
	for (let miner in minersHashrate) {
		if (miner.indexOf('~') === -1) continue;
		data[miner] = minersHashrate[miner];
	}
	let reply = JSON.stringify({
		workersHashrate: data
	});

	response.writeHead("200", {
		'Access-Control-Allow-Origin': '*',
		'Cache-Control': 'no-cache',
		'Content-Type': 'application/json',
		'Content-Length': reply.length
	});
	response.end(reply);
}


/**
 * Authorize access to a secured API call
 **/
function authorize (request, response) {
	let sentPass = url.parse(request.url, true)
		.query.password;

	let remoteAddress = request.connection.remoteAddress;
	if (config.api.trustProxyIP && request.headers['x-forwarded-for']) {
		remoteAddress = request.headers['x-forwarded-for'];
	}

	let bindIp = config.api.bindIp ? config.api.bindIp : "0.0.0.0";
	if (typeof sentPass == "undefined" && (remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '::1' || (bindIp != "0.0.0.0" && remoteAddress === bindIp))) {
		return true;
	}

	response.setHeader('Access-Control-Allow-Origin', '*');

	let cookies = parseCookies(request);
	if (typeof sentPass == "undefined" && cookies.sid && cookies.sid === authSid) {
		return true;
	}

	if (sentPass !== config.api.password) {
		response.statusCode = 401;
		response.end('Invalid password');
		return;
	}

	log('warn', logSystem, 'Admin authorized from %s', [remoteAddress]);
	response.statusCode = 200;

	let cookieExpire = new Date(new Date().getTime() + 60 * 60 * 24 * 1000);
	
	response.setHeader('Set-Cookie', 'sid=' + authSid + '; path=/; expires=' + cookieExpire.toUTCString());
	response.setHeader('Cache-Control', 'no-cache');
	response.setHeader('Content-Type', 'application/json');

	return true;
}

/**
 * Administration: return pool statistics
 **/
function handleAdminStats (response) {
	async.waterfall([

		//Get worker keys & unlocked blocks
		function (callback) {
			redisClient.multi([
					['keys', `${config.coin}:workers:*`],
					['zrange', `${config.coin}:blocks:matured`, 0, -1]
				]).exec(function (error, replies) {
					if (error) {
						log('error', logSystem, 'Error trying to get admin data from redis %j', [error]);
						callback(true);
						return;
					}
					callback(null, replies[0], replies[1]);
				});
		},

		//Get worker balances
		function (workerKeys, blocks, callback) {
			let redisCommands = workerKeys.map(function (k) {
				return ['hmget', k, 'balance', 'paid'];
			});
			redisClient.multi(redisCommands).exec(function (error, replies) {
					if (error) {
						log('error', logSystem, 'Error with getting balances from redis %j', [error]);
						callback(true);
						return;
					}

					callback(null, replies, blocks);
				});
		},
		function (workerData, blocks, callback) {
			let stats = {
				totalOwed: 0,
				totalPaid: 0,
				totalRevenue: 0,
				totalRevenueSolo: 0,
				totalDiff: 0,
				totalDiffSolo: 0,
				totalShares: 0,
				totalSharesSolo: 0,
				blocksOrphaned: 0,
				blocksUnlocked: 0,
				blocksUnlockedSolo: 0,
				totalWorkers: 0
			};

			for (let i = 0; i < workerData.length; i++) {
				stats.totalOwed += parseInt(workerData[i][0]) || 0;
				stats.totalPaid += parseInt(workerData[i][1]) || 0;
				stats.totalWorkers++;
			}

			for (let i = 0; i < blocks.length; i++) {
				let block = blocks[i].split(':');
				if (block[0] === 'prop' || block[0] === 'solo') {
					if (block[7]) {
						if (block[0] === 'solo') {
							stats.blocksUnlockedSolo++
							stats.totalDiffSolo += parseInt(block[4])
							stats.totalSharesSolo += parseInt(block[5])
							stats.totalRevenueSolo += parseInt(block[7])
						} else {
							stats.blocksUnlocked++
							stats.totalDiff += parseInt(block[4])
							stats.totalShares += parseInt(block[5])
							stats.totalRevenue += parseInt(block[7])
						}
					} else {
						stats.blocksOrphaned++
					}
				} else {
					if (block[5]) {
						stats.blocksUnlocked++;
						stats.totalDiff += parseInt(block[2]);
						stats.totalShares += parseInt(block[3]);
						stats.totalRevenue += parseInt(block[5]);
					} else {
						stats.blocksOrphaned++;
					}
				}
			}
			callback(null, stats);
		}
	], function (error, stats) {
		if (error) {
			response.end(JSON.stringify({
				error: 'Error collecting stats'
			}));
			return;
		}
		response.end(JSON.stringify(stats));
	});

}

/**
 * Administration: users list
 **/
function handleAdminUsers (request, response) {
	let otherCoin = url.parse(request.url, true).query.otherCoin;
	async.waterfall([
		// get workers Redis keys
		function (callback) {
			redisClient.keys(`${config.coin}:workers:*`, callback);
		},

		// get workers data
		function (workerKeys, callback) {
			let allCoins = config.childPools.filter(pool => pool.enabled).map(pool => {
					return `${pool.coin}`
				})

			allCoins.push(otherCoin);

			let redisCommands = workerKeys.map(function (k) {
				return ['hmget', k, 'balance', 'paid', 'lastShare', 'hashes', ...allCoins];
			});
			redisClient.multi(redisCommands).exec(function (error, redisData) {
					let workersData = {};
					let keyParts = [];
					let address = '';
					let data = [];
					let wallet = '';
					let coin = null;
					for (let i in redisData) {
						keyParts = workerKeys[i].split(':');
						address = keyParts[keyParts.length - 1];
						data = redisData[i];

						for (let a = 0, b = 4; b <= data.length; a++, b++) {
							if (data[b]) {
								coin = `${allCoins[a]}=${data[b]}`;
								break;
							}
						}

						workersData[address] = {
							pending: data[0],
							paid: data[1],
							lastShare: data[2],
							hashes: data[3],
							childWallet: coin,
							hashrate: minerStats[address] && minerStats[address]['hashrate'] ? minerStats[address]['hashrate'] : 0,
							roundScore: minerStats[address] && minerStats[address]['roundScore'] ? minerStats[address]['roundScore'] : 0,
							roundHashes: minerStats[address] && minerStats[address]['roundHashes'] ? minerStats[address]['roundHashes'] : 0
						};
					}
					callback(null, workersData);
				});
		}
	], function (error, workersData) {
		if (error) {
			response.end(JSON.stringify({
				error: 'Error collecting users stats'
			}));
			return;
		}
		response.end(JSON.stringify(workersData));
	});
}

/**
 * Administration: pool monitoring
 **/
function handleAdminMonitoring (response) {
	response.writeHead("200", {
		'Access-Control-Allow-Origin': '*',
		'Cache-Control': 'no-cache',
		'Content-Type': 'application/json'
	});
	async.parallel({
		monitoring: getMonitoringData,
		logs: getLogFiles
	}, function (error, result) {
		response.end(JSON.stringify(result));
	});
}

/**
 * Administration: log file data
 **/
function handleAdminLog (urlParts, response) {
	let file = urlParts.query.file;
	let filePath = config.logging.files.directory + '/' + file;
	if (!file.match(/^\w+\.log$/)) {
		response.end('wrong log file');
	}
	response.writeHead(200, {
		'Content-Type': 'text/plain',
		'Cache-Control': 'no-cache',
		'Content-Length': fs.statSync(filePath)
			.size
	});
	fs.createReadStream(filePath)
		.pipe(response);
}

/**
 * Administration: pool ports usage
 **/
function handleAdminPorts (request, response) {
	async.waterfall([
		function (callback) {
			redisClient.keys(`${config.coin}:ports:*`, callback);
		},
		function (portsKeys, callback) {
			let redisCommands = portsKeys.map(function (k) {
				return ['hmget', k, 'port', 'users'];
			});
			redisClient.multi(redisCommands).exec(function (error, redisData) {
					let portsData = {};
					let port = ''
					let data = []
					for (let i in redisData) {
						port = portsKeys[i];
						data = redisData[i];
						portsData[port] = {
							port: data[0],
							users: data[1]
						};
					}
					callback(null, portsData);
				});
		}
	], function (error, portsData) {
		if (error) {
			response.end(JSON.stringify({
				error: 'Error collecting Ports stats'
			}));
			return;
		}
		response.end(JSON.stringify(portsData));
	});
}

// Start RPC monitoring
function startRpcMonitoring (rpc, module, method, interval) {
	setInterval(function () {
		rpc(method, {}, function (error, response) {
			let stat = {
				lastCheck: new Date() / 1000 | 0,
				lastStatus: error ? 'fail' : 'ok',
				lastResponse: JSON.stringify(error ? error : response)
			};
			if (error) {
				stat.lastFail = stat.lastCheck;
				stat.lastFailResponse = stat.lastResponse;
			}
			let key = getMonitoringDataKey(module);
			let redisCommands = [];
			for (let property in stat) {
				redisCommands.push(['hset', key, property, stat[property]]);
			}
			redisClient.multi(redisCommands).exec();
		});
	}, interval * 1000);
}

// Start Wallet API monitoring
function startWalletApiMonitoring (interval) {
	setInterval(function () {
		let walletApi = require('./walletApi.js');
		walletApi.getBalance()
			.then((balanceInfo) => {
				let stat = {
					lastCheck: new Date() / 1000 | 0,
					lastStatus: 'ok',
					lastResponse: JSON.stringify(balanceInfo)
				};
				let key = getMonitoringDataKey('wallet');
				let redisCommands = [];
				for (let property in stat) {
					redisCommands.push(['hset', key, property, stat[property]]);
				}
				redisClient.multi(redisCommands).exec();
			})
			.catch((error) => {
				let stat = {
					lastCheck: new Date() / 1000 | 0,
					lastStatus: 'fail',
					lastResponse: error.message || 'Unknown error',
					lastFail: new Date() / 1000 | 0,
					lastFailResponse: error.message || 'Unknown error'
				};
				let key = getMonitoringDataKey('wallet');
				let redisCommands = [];
				for (let property in stat) {
					redisCommands.push(['hset', key, property, stat[property]]);
				}
				redisClient.multi(redisCommands).exec();
			});
	}, interval * 1000);
}

// Return monitoring data key
function getMonitoringDataKey (module) {
	return config.coin + ':status:' + module;
}

// Initialize monitoring
function initMonitoring () {
	let modulesRpc = {
		daemon: apiInterfaces.rpcDaemon,
		price: apiInterfaces.jsonHttpRequest
	};
	let daemonType = config.daemonType ? config.daemonType.toLowerCase() : "default";
	let settings = '';
	for (let module in config.monitoring) {
		settings = config.monitoring[module];
		if (!settings.enabled) continue;

		// Use Wallet API for wallet monitoring
		if (module === 'wallet') {
			if (settings.checkInterval) {
				startWalletApiMonitoring(settings.checkInterval);
			}
			continue;
		}

		if (daemonType === "bytecoin" && module === "wallet" && settings.rpcMethod === "getbalance") {
			settings.rpcMethod = "getBalance";
		}
		if (settings.checkInterval) {
			startRpcMonitoring(modulesRpc[module], module, settings.rpcMethod, settings.checkInterval);
		}
	}
}

// Get monitoring data
function getMonitoringData (callback) {
	let modules = Object.keys(config.monitoring);
	let redisCommands = [];
	for (let i in modules) {
		redisCommands.push(['hgetall', getMonitoringDataKey(modules[i])]);
	}
	redisClient.multi(redisCommands).exec(function (error, results) {
			let stats = {};
			for (let i in modules) {
				if (results[i]) {
					stats[modules[i]] = results[i];
				}
			}
			callback(error, stats);
		});
}

/**
 * Return pool public ports
 **/
function getPublicPorts (ports) {
	return ports.filter(function (port) {
		return !port.hidden;
	});
}

/**
 * Return list of pool logs file
 **/
function getLogFiles (callback) {
	let dir = config.logging.files.directory;
	fs.readdir(dir, function (error, files) {
		let logs = {};
		let file = ''
		let stats = '';
		for (let i in files) {
			file = files[i];
			stats = fs.statSync(dir + '/' + file);
			logs[file] = {
				size: stats.size,
				changed: Date.parse(stats.mtime) / 1000 | 0
			}
		}
		callback(error, logs);
	});
}

/**
 * Check if a miner has been seen with specified IP address
 **/
function minerSeenWithIPForAddress (address, ip, callback) {
	let ipv4_regex = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;
	if (ipv4_regex.test(ip)) {
		ip = '::ffff:' + ip;
	}
	redisClient.sismember([`${config.coin}:workers_ip:${address}`, ip], function (error, result) {
		let found = result > 0 ? true : false;
		callback(error, found);
	});
}

/**
 * Parse cookies data
 **/
function parseCookies (request) {
	let list = {},
		rc = request.headers.cookie;
	rc && rc.split(';').forEach(function (cookie) {
			let parts = cookie.split('=');
			list[parts.shift().trim()] = unescape(parts.join('='));
		});
	return list;
}
/**
 * Start pool API
 **/

// Collect statistics for the first time
collectStats();

// Initialize RPC monitoring
initMonitoring();

// Enable to be bind to a certain ip or all by default
let bindIp = config.api.bindIp ? config.api.bindIp : "0.0.0.0";

// Start API on HTTP port
let server = http.createServer(function (request, response) {
	if (request.method.toUpperCase() === "OPTIONS") {
		response.writeHead("204", "No Content", {
			"access-control-allow-origin": '*',
			"access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
			"access-control-allow-headers": "content-type, accept",
			"access-control-max-age": 10, // Seconds.
			"content-length": 0
		});
		return (response.end());
	}

	handleServerRequest(request, response);
});

server.listen(config.api.port, bindIp, function () {
	log('info', logSystem, 'API started & listening on %s port %d', [bindIp, config.api.port]);
});

// Start API on SSL port
if (config.api.ssl) {
	if (!config.api.sslCert) {
		log('error', logSystem, 'Could not start API listening on %s port %d (SSL): SSL certificate not configured', [bindIp, config.api.sslPort]);
	} else if (!config.api.sslKey) {
		log('error', logSystem, 'Could not start API listening on %s port %d (SSL): SSL key not configured', [bindIp, config.api.sslPort]);
	} else if (!config.api.sslCA) {
		log('error', logSystem, 'Could not start API listening on %s port %d (SSL): SSL certificate authority not configured', [bindIp, config.api.sslPort]);
	} else if (!fs.existsSync(config.api.sslCert)) {
		log('error', logSystem, 'Could not start API listening on %s port %d (SSL): SSL certificate file not found (configuration error)', [bindIp, config.api.sslPort]);
	} else if (!fs.existsSync(config.api.sslKey)) {
		log('error', logSystem, 'Could not start API listening on %s port %d (SSL): SSL key file not found (configuration error)', [bindIp, config.api.sslPort]);
	} else if (!fs.existsSync(config.api.sslCA)) {
		log('error', logSystem, 'Could not start API listening on %s port %d (SSL): SSL certificate authority file not found (configuration error)', [bindIp, config.api.sslPort]);
	} else {
		let options = {
			key: fs.readFileSync(config.api.sslKey),
			cert: fs.readFileSync(config.api.sslCert),
			ca: fs.readFileSync(config.api.sslCA),
			honorCipherOrder: true
		};

		let ssl_server = https.createServer(options, function (request, response) {
			if (request.method.toUpperCase() === "OPTIONS") {
				response.writeHead("204", "No Content", {
					"access-control-allow-origin": '*',
					"access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
					"access-control-allow-headers": "content-type, accept",
					"access-control-max-age": 10, // Seconds.
					"content-length": 0,
					"strict-transport-security": "max-age=604800"
				});
				return (response.end());
			}

			handleServerRequest(request, response);
		});

		ssl_server.listen(config.api.sslPort, bindIp, function () {
			log('info', logSystem, 'API started & listening on %s port %d (SSL)', [bindIp, config.api.sslPort]);
		});
	}
}
