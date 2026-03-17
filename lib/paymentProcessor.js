/**
 * Cryptonote Node.JS Pool
 * https://github.com/dvandal/cryptonote-nodejs-pool
 *
 * Payments processor with Pastella Wallet API integration
 **/

// Load required modules
let fs = require('fs');
let async = require('async');

let walletApi = require('./walletApi.js');
let utils = require('./utils.js');

// Initialize log system
let logSystem = 'payments';
require('./exceptionWriter.js')(logSystem);

/**
 * Load blocked addresses from payment_blocked.json
 **/
let blockedAddresses = [];

function loadBlockedAddresses() {
	try {
		let blockedFile = __dirname + '/../payment_blocked.json';
		if (fs.existsSync(blockedFile)) {
			let blockedData = JSON.parse(fs.readFileSync(blockedFile, 'utf8'));
			if (blockedData.blockedAddresses && Array.isArray(blockedData.blockedAddresses)) {
				blockedAddresses = blockedData.blockedAddresses;
				log('info', logSystem, 'Loaded %d blocked payment addresses', [blockedAddresses.length]);
				if (blockedAddresses.length > 0) {
					log('info', logSystem, 'Blocked addresses: %j', [blockedAddresses]);
				}
			}
		} else {
			log('info', logSystem, 'No payment_blocked.json file found, no addresses blocked');
		}
	} catch (error) {
		log('warn', logSystem, 'Failed to load payment_blocked.json: %s', [error.message]);
	}
}

/**
 * Check if an address is blocked
 **/
function isAddressBlocked(address) {
	// Handle fixed difficulty separator
	let checkAddress = address;
	if (config.poolServer.fixedDiff && config.poolServer.fixedDiff.enabled) {
		let addr = address.split(config.poolServer.fixedDiff.addressSeparator);
		if (addr.length >= 2) checkAddress = addr[0];
	}
	return blockedAddresses.includes(checkAddress);
}

// Load blocked addresses on startup
loadBlockedAddresses();

/**
 * Run payments processor
 **/

// Check if payments are enabled
if (!config.payments.enabled) {
	log('info', logSystem, 'Payments are disabled in config. Exiting.');
	process.exit(0);
}

log('info', logSystem, 'Started with Pastella Wallet API');

if (!config.payments.priority) config.payments.priority = 0;

// Initialize wallet first
log('info', logSystem, 'Initializing wallet...');

walletApi.initializeWallet()
	.then(() => {
		let walletAddress = walletApi.getWalletAddress();

		// Check if pool address matches wallet address
		if (config.poolServer.poolAddress !== walletAddress) {
			log('warn', logSystem, 'Pool address mismatch! Block rewards will be lost!');
			log('warn', logSystem, 'Config has: %s', [config.poolServer.poolAddress]);
			log('warn', logSystem, 'Wallet has: %s', [walletAddress]);
		}

		log('info', logSystem, 'Payment processor started (interval: %d seconds)', [config.payments.interval]);

		// Start payment interval
		setTimeout(runInterval, 5000); // Start after 5 seconds
	})
	.catch((error) => {
		log('error', logSystem, 'Failed to initialize wallet: %s', [error.message]);
		log('error', logSystem, 'Payment processor cannot start without wallet access');
		process.exit(1);
	});

function runInterval () {
	// Reload blocked addresses on each run (in case file was updated)
	loadBlockedAddresses();

	async.waterfall([

		// Get worker keys
		function (callback) {
			redisClient.keys(config.coin + ':workers:*', function (error, result) {
				if (error) {
					log('error', logSystem, 'Error trying to get worker balances from redis %j', [error]);
					callback(true);
					return;
				}
				callback(null, result);
			});
		},

		// Get worker balances
		function (keys, callback) {
			let redisCommands = keys.map(function (k) {
				return ['hget', k, 'balance'];
			});
			redisClient.multi(redisCommands)
				.exec(function (error, replies) {
					if (error) {
						log('error', logSystem, 'Error with getting balances from redis %j', [error]);
						callback(true);
						return;
					}

					let balances = {};
					for (let i = 0; i < replies.length; i++) {
						let parts = keys[i].split(':');
						let workerId = parts[parts.length - 1];

						balances[workerId] = parseInt(replies[i]) || 0;
					}
					callback(null, keys, balances);
				});
		},

		// Get worker minimum payout
		function (keys, balances, callback) {
			let redisCommands = keys.map(function (k) {
				return ['hget', k, 'minPayoutLevel'];
			});
			redisClient.multi(redisCommands)
				.exec(function (error, replies) {
					if (error) {
						log('error', logSystem, 'Error with getting minimum payout from redis %j', [error]);
						callback(true);
						return;
					}

					let minPayoutLevel = {};
					for (let i = 0; i < replies.length; i++) {
						let parts = keys[i].split(':');
						let workerId = parts[parts.length - 1];

						let minLevel = config.payments.minPayment;
						let maxLevel = config.payments.maxPayment;
						let defaultLevel = minLevel;

						let payoutLevel = parseInt(replies[i]) || minLevel;
						if (payoutLevel < minLevel) payoutLevel = minLevel;
						if (maxLevel && payoutLevel > maxLevel) payoutLevel = maxLevel;
						minPayoutLevel[workerId] = payoutLevel;

						if (payoutLevel !== defaultLevel) {
							log('info', logSystem, 'Using payout level of %s for %s (default: %s)', [utils.getReadableCoins(minPayoutLevel[workerId]), workerId, utils.getReadableCoins(defaultLevel)]);
						}
					}
					callback(null, balances, minPayoutLevel);
				});
		},

		// Check wallet balance first
		function (balances, minPayoutLevel, callback) {
			walletApi.getBalance()
				.then((balanceInfo) => {
					let totalNeeded = 0;
					for (let worker in balances) {
						if (balances[worker] >= minPayoutLevel[worker]) {
							totalNeeded += balances[worker];
						}
					}

					log('info', logSystem, 'Wallet balance: %s (unlocked), %s (locked), needed for payments: %s', [
						utils.getReadableCoins(balanceInfo.unlocked),
						utils.getReadableCoins(balanceInfo.locked),
						utils.getReadableCoins(totalNeeded)
					]);

					if (balanceInfo.unlocked < totalNeeded) {
						log('warn', logSystem, 'Insufficient wallet balance for all payments. Have: %s, Need: %s', [
							utils.getReadableCoins(balanceInfo.unlocked),
							utils.getReadableCoins(totalNeeded)
						]);
						callback(true);
						return;
					}

					callback(null, balances, minPayoutLevel);
				})
				.catch((error) => {
					log('error', logSystem, 'Error checking wallet balance: %s', [error.message]);
					callback(true);
				});
		},

		// Filter workers under balance threshold for payment
		function (balances, minPayoutLevel, callback) {
			let payments = {};
			let blockedAddressesFound = [];

			for (let worker in balances) {
				// Check if address is blocked
				if (isAddressBlocked(worker)) {
					blockedAddressesFound.push({ address: worker, amount: balances[worker] });
					log('info', logSystem, 'Skipping blocked address: %s (balance: %s)', [
						worker,
						utils.getReadableCoins(balances[worker])
					]);
					continue;
				}

				let balance = balances[worker];
				if (balance >= minPayoutLevel[worker]) {
					let remainder = balance % config.payments.denomination;
					let payout = balance - remainder;

					if (config.payments.dynamicTransferFee && config.payments.minerPayFee) {
						payout -= config.payments.transferFee;
					}
					if (payout < 0) continue;

					payments[worker] = payout;
				}
			}

			// Log skipped blocked addresses
			if (blockedAddressesFound.length > 0) {
				log('info', logSystem, 'Blocked %d addresses from payment_blocked.json', [blockedAddressesFound.length]);
				for (let i = 0; i < blockedAddressesFound.length; i++) {
					log('info', logSystem, '  - %s (would have paid: %s)', [
						blockedAddressesFound[i].address,
						utils.getReadableCoins(blockedAddressesFound[i].amount)
					]);
				}
			}

			if (Object.keys(payments).length === 0) {
				log('info', logSystem, 'No workers\' balances reached the minimum payment threshold');
				callback(true);
				return;
			}

			// Group payments into batches
			let paymentBatches = [];
			let currentBatch = [];
			let batchAmount = 0;
			let maxAddresses = config.payments.maxAddresses || 15;
			let maxTxAmount = config.payments.maxTransactionAmount || 10000000000;

			for (let worker in payments) {
				let amount = parseInt(payments[worker]);
				let address = worker;

				// Handle fixed difficulty separator
				if (config.poolServer.fixedDiff && config.poolServer.fixedDiff.enabled) {
					let addr = address.split(config.poolServer.fixedDiff.addressSeparator);
					if (addr.length >= 2) address = addr[0];
				}

				// Check if we need to start a new batch
				if (currentBatch.length >= maxAddresses || (batchAmount + amount > maxTxAmount && currentBatch.length > 0)) {
					paymentBatches.push(currentBatch);
					currentBatch = [];
					batchAmount = 0;
				}

				currentBatch.push({
					address: address,
					amount: amount,
					worker: worker
				});
				batchAmount += amount;
			}

			if (currentBatch.length > 0) {
				paymentBatches.push(currentBatch);
			}

			log('info', logSystem, 'Preparing to send %d payments to %d workers in %d batches', [
				Object.keys(payments).length,
				Object.keys(payments).length,
				paymentBatches.length
			]);

			// Process each batch
			let completedBatches = 0;
			let notify_miners = [];

			async.each(paymentBatches, function (batch, batchCallback) {
				let destinations = batch.map(p => ({
					address: p.address,
					amount: p.amount
				}));

				// Send payments using Wallet API
				walletApi.sendAdvancedTransaction(destinations)
					.then((result) => {
						let txHash = result.transactionHash;
						let fee = result.fee;
						let now = Date.now() / 1000 | 0;

						log('info', logSystem, 'Sent batch of %d payments, TX hash: %s, fee: %s', [
							destinations.length,
							txHash,
							utils.getReadableCoins(fee)
						]);

						// Update Redis
						let redisCommands = [];

						// Record payment
						redisCommands.push(['zadd', config.coin + ':payments:all', now, [
							txHash,
							batch.reduce((sum, p) => sum + p.amount, 0),
							fee,
							0,
							destinations.length,
							batch[0].address  // Include first recipient address for display
						].join(':')]);

						// Update worker balances
						for (let i = 0; i < batch.length; i++) {
							let payment = batch[i];
							let amount = payment.amount;

							redisCommands.push(['hincrby', config.coin + ':workers:' + payment.worker, 'balance', -amount]);
							redisCommands.push(['hincrby', config.coin + ':workers:' + payment.worker, 'paid', amount]);
							redisCommands.push(['zadd', config.coin + ':payments:' + payment.address, now, [
								txHash,
								amount,
								fee,
								0
							].join(':')]);

							notify_miners.push({
								address: payment.address,
								amount: amount
							});
						}

						redisClient.multi(redisCommands)
							.exec(function (error) {
								if (error) {
									log('error', logSystem, 'Critical error updating Redis: %j', [error]);
									batchCallback(error);
									return;
								}

								completedBatches++;
								log('info', logSystem, 'Completed batch %d/%d', [completedBatches, paymentBatches.length]);
								batchCallback();
							});
					})
					.catch((error) => {
						log('error', logSystem, 'Failed to send payment batch: %s', [error.message]);
						log('error', logSystem, 'Payments failed for %j', destinations);
						batchCallback(error);
					});

			}, function (error) {
				if (error) {
					log('error', logSystem, 'Some payment batches failed');
					callback(null);
					return;
				}

				// Log all payments
				for (let m in notify_miners) {
					let notify = notify_miners[m];
					log('info', logSystem, 'Payment of %s to %s', [utils.getReadableCoins(notify.amount), notify.address]);
				}

				log('info', logSystem, 'Payment round complete');
				callback(null);
			});
		}

	], function (error) {
		setTimeout(runInterval, config.payments.interval * 1000);
	});
}
