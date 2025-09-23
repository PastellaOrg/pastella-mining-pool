const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');

// Import atomic units utility
const { fromAtomicUnits } = require('./utils/atomicUnits.js');

// Import components
const ConfigManager = require('./config/config-manager.js');
const DatabaseManager = require('./database/database-manager.js');
const BlockTemplateManager = require('./mining/block-template-manager.js');
const ShareValidator = require('./mining/share-validator.js');
const StratumServer = require('./stratum/stratum-server.js');
const PaymentProcessor = require('./payments/payment-processor.js');
const logger = require('./utils/logger.js');

class MiningPool {
  constructor() {
    this.config = new ConfigManager();
    this.database = new DatabaseManager(this.config);
    this.blockTemplateManager = new BlockTemplateManager(this.config);
    this.shareValidator = new ShareValidator(this.config, this.blockTemplateManager);
    this.stratumServer = new StratumServer(this.config);
    this.paymentProcessor = new PaymentProcessor(this);

    // Set up component connections
    this.stratumServer.setShareValidator(this.shareValidator);
    this.stratumServer.setBlockTemplateManager(this.blockTemplateManager);
    this.stratumServer.setDatabaseManager(this.database);

    // 🎯 CRITICAL FIX: Set stratum server reference in share validator for job tracking
    this.shareValidator.stratumServer = this.stratumServer;
    this.shareValidator.databaseManager = this.database;

    // Set up immediate job updates when new templates are available
    this.blockTemplateManager.setNewTemplateCallback((template) => {
      this.stratumServer.jobManager.updateJobs();
    });

    // Express app
    this.app = express();
    this.server = null;
    this.isRunning = false;

    // Network data caching (15 second cache)
    this.networkCache = {
      data: null,
      timestamp: 0,
      ttl: 15000 // 15 seconds
    };

    // Statistics
    this.stats = {
      startTime: Date.now(),
      totalShares: 0,
      validShares: 0,
      invalidShares: 0,
      blocksFound: 0,
      lastBlockFound: null,
    };

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup middleware
   */
  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../public')));

    // Add request logging
    this.app.use((req, res, next) => {
      next();
    });
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    });

    // Pool status
    this.app.get('/api/status', async (req, res) => {
      try {
        const template = this.blockTemplateManager.getTemplateInfo();
        const stratumStats = this.stratumServer.getStats();
        const shareStats = this.shareValidator.getStats();

        // Get additional statistics for performance metrics
        const recentBlocks = await this.database.getBlocks(10, 0);
        const totalBlocksFound = await this.database.getBlocksCount();
        const allMiners = await this.database.getMiners();
        // TODO: Implement payment tracking system
        const totalPayments = 0; // Placeholder until payment system is implemented

        // Calculate average block time from recent blocks
        let avgBlockTime = 0;
        const targetBlockTime = this.config.get('daemon.blockTime') || 15; // Get from config, default to 15 seconds
        let avgBlockTimeDisplay = `${targetBlockTime}s`; // Default to config block time

        if (recentBlocks && recentBlocks.length > 1) {
          const blockTimes = [];
          for (let i = 1; i < recentBlocks.length; i++) {
            const timeDiff = recentBlocks[i-1].created_at - recentBlocks[i].created_at;
            if (timeDiff > 0) blockTimes.push(timeDiff);
          }
          if (blockTimes.length > 0) {
            avgBlockTime = blockTimes.reduce((a, b) => a + b, 0) / blockTimes.length;
            avgBlockTimeDisplay = Math.round(avgBlockTime / 1000); // Convert to seconds for display
          }
        } else if (recentBlocks && recentBlocks.length === 1) {
          // Only one block found, can't calculate average, show time since first block
          const timeSinceFirst = Date.now() - recentBlocks[0].created_at;
          avgBlockTimeDisplay = `${Math.round(timeSinceFirst / (1000 * 60))}m+`;
        } else {
          // No blocks found yet by this pool, show config block time
          avgBlockTimeDisplay = `${targetBlockTime}s`;
        }

        // If no calculation possible, use configured block time
        if (avgBlockTime === 0) {
          avgBlockTime = targetBlockTime * 1000; // Convert to milliseconds for internal calculations
        }

        const status = {
          pool: {
            name: this.config.get('pool.name'),
            version: this.config.get('pool.version'),
            algorithm: this.config.get('mining.algorithm'),
            fee: this.config.get('pool.fee'),
            minPayout: this.config.get('pool.minPayout'),
            blockExplorer: this.config.get('pool.blockExplorer'),
          },
          mining: {
            blockHeight: template.available ? template.index : 0,
            poolDifficulty: template.available ? template.poolDifficulty : 0,
            blockDifficulty: template.available ? template.difficulty : 0,
            transactionCount: template.available ? template.transactionCount : 0,
            templateAge: template.available ? template.age : 0,
            // Sensitive template data excluded for security
          },
          stratum: {
            connections: stratumStats.activeConnections,
            totalConnections: stratumStats.totalConnections,
            shares: {
              total: shareStats.totalShares,
              valid: shareStats.validShares,
              invalid: shareStats.invalidShares,
              rate: shareStats.validShareRate,
            },
          },
          performance: {
            avgBlockTime: avgBlockTimeDisplay,
            totalMiners: allMiners.length,
            totalPaid: totalPayments || 0,
            blocksFound: totalBlocksFound,
            networkDifficulty: template.available ? template.difficulty : 0
          },
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        };

        res.json(status);
      } catch (error) {
        logger.error(`Error getting status: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

        // Database miners (all miners that have ever connected)
    this.app.get('/api/miners', async (req, res) => {
      try {
        const miners = await this.database.getMiners();

        // Get share statistics for each miner
        const minersWithStats = await Promise.all(
          miners.map(async (miner) => {
            const shareStats = await this.database.getMinerShareStats(miner.id);
            return {
              id: miner.id,
              address: miner.address,
              worker_name: miner.worker_name,
              hashrate: miner.hashrate,
              shares: miner.shares,
              last_seen: miner.last_seen,
              created_at: miner.created_at,
              share_stats: {
                total: shareStats.total_shares || 0,
                valid: shareStats.valid_shares || 0,
                rejected: shareStats.rejected_shares || 0,
                blocks_found: shareStats.blocks_found || 0
              }
            };
          })
        );

        res.json({
          miners: minersWithStats,
          count: miners.length,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(`Error getting miners: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Connected miners (currently active)
    this.app.get('/api/miners/connected', (req, res) => {
      try {
        const clients = Array.from(this.stratumServer.clients.values());
        const miners = clients
          .filter(client => client.authorized)
          .map(client => ({
            id: client.id,
            workerName: client.workerName,
            address: client.address,
            connectedAt: client.connectedAt,
            lastActivity: client.lastActivity,
            difficulty: client.difficulty,
            subscribed: client.subscribed,
          }));

        res.json({
          miners: miners,
          count: miners.length,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(`Error getting connected miners: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Real-time hashrate data for connected miners
    this.app.get('/api/miners/hashrate', (req, res) => {
      try {
        const clients = Array.from(this.stratumServer.clients.values());
        const miners = clients
          .filter(client => client.authorized)
          .map(client => ({
            id: client.id,
            address: client.address,
            workerName: client.workerName,
            hashrate: client.hashrate || 0,
            difficulty: client.difficulty || 1,
            lastActivity: client.lastActivity || Date.now(),
            connectedAt: client.connectedAt || Date.now()
          }));

        // Calculate total hashrate using the stratum server's calculation
        const totalHashrate = this.stratumServer.calculateTotalHashrate();

        res.json({
          miners: miners,
          totalHashrate: totalHashrate,
          count: miners.length,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(`Error getting hashrate data: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get specific miner by ID
    this.app.get('/api/miners/:id', async (req, res) => {
      try {
        const minerId = req.params.id;
        const miner = await this.database.getMiner(minerId);

        if (!miner) {
          return res.status(404).json({ error: 'Miner not found' });
        }

        // Get miner's shares and share statistics
        const [shares, shareStats] = await Promise.all([
          this.database.getMinerShares(minerId, 100),
          this.database.getMinerShareStats(minerId)
        ]);

        res.json({
          miner: {
            id: miner.id,
            address: miner.address,
            worker_name: miner.worker_name,
            hashrate: miner.hashrate,
            shares: miner.shares,
            last_seen: miner.last_seen,
            created_at: miner.created_at
          },
          share_stats: {
            total: shareStats.total_shares || 0,
            valid: shareStats.valid_shares || 0,
            rejected: shareStats.rejected_shares || 0,
            blocks_found: shareStats.blocks_found || 0,
            acceptance_rate: shareStats.total_shares > 0 ?
              ((shareStats.valid_shares / shareStats.total_shares) * 100).toFixed(2) : 0
          },
          recentShares: shares.map(share => ({
            timestamp: share.timestamp,
            difficulty: share.difficulty,
            valid: share.is_valid === 1,
            miner_id: share.miner_id,
            worker_name: share.worker_name,
            job_id: share.job_id,
            extra_nonce2: share.extra_nonce2,
            n_time: share.n_time,
            nonce: share.nonce,
            is_block: share.is_block === 1
          }))
        });
      } catch (error) {
        logger.error(`Error getting miner ${req.params.id}: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get miners grouped by address (fixes duplicate address issue)
    this.app.get('/api/miners/grouped', async (req, res) => {
      try {
        const groupedMiners = await this.database.getMinersGroupedByAddress();
        
        res.json({
          miners: groupedMiners.map(group => ({
            address: group.address,
            worker_count: group.worker_count,
            total_hashrate: group.total_hashrate,
            total_shares: group.total_shares,
            last_seen: group.last_seen,
            first_seen: group.first_seen,
            worker_names: group.worker_names ? group.worker_names.split(',') : [],
            worker_ids: group.worker_ids ? group.worker_ids.split(',') : [],
            is_online: (Date.now() - group.last_seen) < 300000 // Online if seen within 5 minutes
          }))
        });
      } catch (error) {
        logger.error(`Error getting grouped miners: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get miner stats by wallet address (for miner lookup page)
    this.app.get('/api/miners/address/:address', async (req, res) => {
      try {
        const address = req.params.address;
        const miners = await this.database.all('SELECT * FROM miners WHERE address = ? ORDER BY last_seen DESC', [address]);
        
        // Try to get persistent leaderboard data for enhanced stats
        const leaderboardData = await this.database.getMinerFromLeaderboard(address);
        const latestStats = await this.database.getLatestMinerStats(address);
        
        // If no active miners but we have historical data, show current status (zeros) with historical totals
        if (miners.length === 0 && (leaderboardData || latestStats)) {
          const persistentData = leaderboardData || {};
          const statsData = latestStats || {};
          
          // Get recent shares for this address (even from historical data)
          // Use composite key approach since miner records might be cleaned up
          const recentShares = await this.database.all(
            `SELECT s.*
            FROM shares s
            WHERE s.miner_id LIKE ? 
            ORDER BY s.timestamp DESC LIMIT 20`,
            [`${address}.%`]
          );

          return res.json({
            address: address,
            worker_count: 0, // No active workers
            total_hashrate: 0, // No current hashrate
            avg_hashrate_1h: 0, // No current hashrate
            avg_hashrate_3h: 0, // No current hashrate
            avg_hashrate_24h: 0, // No current hashrate
            total_shares: persistentData.total_shares || 0, // Keep historical share count
            valid_shares: persistentData.valid_shares || 0,
            rejected_shares: persistentData.rejected_shares || 0,
            blocks_found: persistentData.blocks_found || 0,
            confirmed_balance: fromAtomicUnits(persistentData.confirmed_balance || 0),
            unconfirmed_balance: fromAtomicUnits(persistentData.unconfirmed_balance || 0),
            total_paid: fromAtomicUnits(persistentData.total_paid || 0),
            last_seen: persistentData.last_active || 0,
            first_seen: persistentData.first_seen || 0,
            is_online: false,
            is_persistent: true,
            workers: [],
            recent_shares: recentShares.map(share => ({
              timestamp: share.timestamp,
              difficulty: share.difficulty,
              valid: share.is_valid === 1,
              worker_name: share.worker_name,
              is_block: share.is_block === 1,
              block_height: null
            }))
          });
        }

        // If no miners found and no historical data
        if (miners.length === 0) {
          return res.status(404).json({ error: 'No miners found for this address' });
        }

        // Get combined statistics for all workers under this address
        const totalHashrate = miners.reduce((sum, miner) => sum + (miner.hashrate || 0), 0);
        const totalShares = miners.reduce((sum, miner) => sum + (miner.shares || 0), 0);
        const lastSeen = Math.max(...miners.map(miner => miner.last_seen));
        const firstSeen = Math.min(...miners.map(miner => miner.created_at));

        // Get enhanced share stats
        const shareStats = await this.database.getMinerShareStats(miners[0].id);

        // Get recent shares with block height for this address (increased to 120)
        const recentShares = await this.database.all(
          `SELECT s.*
          FROM shares s
          WHERE miner_id IN (SELECT id FROM miners WHERE address = ?) 
          ORDER BY s.timestamp DESC LIMIT 20`,
          [address]
        );

        // Calculate average hashrates from history
        const avgHashrates = await this.database.calculateMinerAverageHashrates(address);

        res.json({
          address: address,
          worker_count: miners.length,
          total_hashrate: totalHashrate,
          avg_hashrate_1h: avgHashrates.avg_hashrate_1h,
          avg_hashrate_3h: avgHashrates.avg_hashrate_3h,
          avg_hashrate_24h: avgHashrates.avg_hashrate_24h,
          total_shares: shareStats.total_shares || totalShares,
          valid_shares: shareStats.valid_shares || 0,
          rejected_shares: shareStats.rejected_shares || 0,
          blocks_found: shareStats.blocks_found || 0,
          confirmed_balance: fromAtomicUnits(leaderboardData?.confirmed_balance || 0),
          unconfirmed_balance: fromAtomicUnits(leaderboardData?.unconfirmed_balance || 0),
          total_paid: fromAtomicUnits(leaderboardData?.total_paid || 0),
          last_seen: lastSeen,
          first_seen: firstSeen,
          is_online: (Date.now() - lastSeen) < 300000, // Online if seen within 5 minutes
          is_persistent: false,
          workers: miners.map(miner => ({
            id: miner.id,
            worker_name: miner.worker_name,
            hashrate: miner.hashrate,
            shares: miner.shares,
            last_seen: miner.last_seen,
            created_at: miner.created_at
          })),
          recent_shares: recentShares.map(share => ({
            timestamp: share.timestamp,
            difficulty: share.difficulty,
            valid: share.is_valid === 1,
            worker_name: share.worker_name,
            is_block: share.is_block === 1,
            block_height: null
          }))
        });
      } catch (error) {
        logger.error(`Error getting miner by address ${req.params.address}: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Mining shares (hybrid database and in-memory stats)
    this.app.get('/api/shares/stats', async (req, res) => {
      try {
        const shareStats = this.shareValidator.getStats();
        const totalShareStats = await this.database.getTotalShareStats();
        const totalBlocks = await this.database.getBlocks(1); // Just get count

        // Use database stats for persistent data (survives restarts)
        const dbBlocksFound = totalShareStats?.blocks_found || 0;
        const dbTotalShares = totalShareStats?.total_shares || 0;
        const dbValidShares = totalShareStats?.valid_shares || 0;
        const dbInvalidShares = totalShareStats?.rejected_shares || 0;
        const dbValidRate = dbTotalShares > 0 ? ((dbValidShares / dbTotalShares) * 100).toFixed(2) : 0;

        res.json({
          shares: {
            total: dbTotalShares,
            valid: dbValidShares,
            invalid: dbInvalidShares,
            stale: shareStats.staleShares, // Keep in-memory for stale (not stored in DB)
            rate: parseFloat(dbValidRate),
          },
          blocks: {
            found: dbBlocksFound,
            lastFound: shareStats.lastBlockFound, // Keep in-memory for timestamp
          },
          memory: {
            // Also include current session stats for debugging
            shares: {
              total: shareStats.totalShares,
              valid: shareStats.validShares,
              invalid: shareStats.invalidShares,
              rate: shareStats.validShareRate
            },
            blocks: {
              found: shareStats.blocksFound
            }
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(`Error getting share stats: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Database shares (persistent share data)
    this.app.get('/api/shares', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const minerId = req.query.miner_id;

        let shares;
        if (minerId) {
          shares = await this.database.getMinerShares(minerId, limit);
        } else {
          shares = await this.database.getShares(limit, offset);
        }

        res.json({
          shares: shares.map(share => ({
            timestamp: share.timestamp,
            difficulty: share.difficulty,
            valid: share.is_valid === 1,
            miner_id: share.miner_id,
            worker_name: share.worker_name,
            job_id: share.job_id,
            extra_nonce2: share.extra_nonce2,
            n_time: share.n_time,
            nonce: share.nonce,
            is_block: share.is_block === 1
          })),
          pagination: {
            limit,
            offset,
            total: shares.length
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(`Error getting shares: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Block template (frontend-safe version)
    this.app.get('/api/block-template', (req, res) => {
      try {
        const template = this.blockTemplateManager.getTemplateInfo();
        
        // Only send frontend-safe data, exclude sensitive mining information
        const frontendSafeTemplate = {
          available: template.available,
          index: template.index,
          difficulty: template.difficulty,
          poolDifficulty: template.poolDifficulty,
          transactionCount: template.transactionCount,
          expiresAt: template.expiresAt,
          lastUpdate: template.lastUpdate,
          age: template.age,
          // Sensitive data excluded: merkleRoot, coinbase, previousHash, timestamp
        };
        
        res.json(frontendSafeTemplate);
      } catch (error) {
        logger.error(`Error getting block template: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Per-block rewards for all miners
    this.app.get('/api/rewards/blocks', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const blockRewards = await this.database.getBlockRewards(limit);

        res.json({
          rewards: blockRewards.map(reward => ({
            block_height: reward.block_height,
            block_hash: reward.block_hash,
            miner_address: reward.miner_address,
            base_reward: reward.base_reward,
            pool_fee: reward.pool_fee,
            miner_reward: reward.miner_reward,
            miner_percentage: reward.miner_percentage,
            block_status: reward.block_status || 'pending',
            timestamp: reward.timestamp
          })),
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Error getting block rewards: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Per-block rewards for specific miner address
    this.app.get('/api/miners/address/:address/rewards', async (req, res) => {
      try {
        const address = req.params.address;
        const limit = parseInt(req.query.limit) || 100;
        const blockRewards = await this.database.getMinerBlockRewards(address, limit);
        const balanceInfo = await this.database.getMinerBalance(address);

        // Convert atomic units to PAS for balance display
        const { fromAtomicUnits } = require('./utils/atomicUnits.js');

        res.json({
          address: address,
          rewards: blockRewards.map(reward => ({
            block_height: reward.block_height,
            block_hash: reward.block_hash, // Keep full hash for frontend links
            base_reward: reward.base_reward,
            pool_fee: reward.pool_fee,
            miner_reward: reward.miner_reward,
            miner_percentage: reward.miner_percentage,
            block_status: this.getBlockStatus(reward.block_height),
            timestamp: reward.timestamp
          })),
          total_rewards: blockRewards.reduce((sum, reward) => sum + reward.miner_reward, 0),
          blocks_found: blockRewards.length,
          confirmed_balance: fromAtomicUnits(await this.database.calculateConfirmedBalance(req.params.address)),
          unconfirmed_balance: fromAtomicUnits(await this.database.calculateUnconfirmedBalance(req.params.address)),
          total_paid: fromAtomicUnits(balanceInfo.total_paid || 0),
          timestamp: new Date().toISOString(),
          blockExplorer: this.config.get('pool.blockExplorer') || 'http://127.0.0.1:3004'
        });
      } catch (error) {
        logger.error(`Error getting miner rewards for ${req.params.address}: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Pool statistics (in-memory)
    this.app.get('/api/pool-stats', (req, res) => {
      try {
        const template = this.blockTemplateManager.getTemplateInfo();
        const stratumStats = this.stratumServer.getStats();
        const shareStats = this.shareValidator.getStats();

        const stats = {
          pool: {
            name: this.config.get('pool.name'),
            version: this.config.get('pool.version'),
            algorithm: this.config.get('mining.algorithm'),
            fee: this.config.get('pool.fee'),
            minPayout: this.config.get('pool.minPayout'),
            payoutInterval: this.config.get('pool.payoutInterval'),
          },
          mining: {
            template: template,
            poolDifficulty: template.available ? template.poolDifficulty : 0,
            blockDifficulty: template.available ? template.difficulty : 0,
            shareTimeout: this.config.get('mining.shareTimeout'),
            maxShareAge: this.config.get('mining.maxShareAge'),
          },
          stratum: {
            port: this.config.get('stratum.port'),
            connections: stratumStats.activeConnections,
            totalConnections: stratumStats.totalConnections,
            jobs: stratumStats.jobs,
          },
          shares: {
            total: shareStats.totalShares,
            valid: shareStats.validShares,
            invalid: shareStats.invalidShares,
            stale: shareStats.staleShares,
            rate: shareStats.validShareRate,
          },
          blocks: {
            found: shareStats.blocksFound,
            lastFound: shareStats.lastBlockFound,
          },
          uptime: process.uptime(),
          startTime: this.stats.startTime,
          timestamp: new Date().toISOString(),
        };

        res.json(stats);
      } catch (error) {
        logger.error(`Error getting pool stats: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

        // Database pool statistics (persistent)
    this.app.get('/api/pool-stats/database', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 100;
        const poolStats = await this.database.getPoolStats(limit);

        res.json({
          stats: poolStats.map(stat => ({
            timestamp: stat.timestamp,
            total_hashrate: stat.total_hashrate,
            active_miners: stat.active_miners,
            total_shares: stat.total_shares,
            valid_shares: stat.valid_shares,
            invalid_shares: stat.invalid_shares,
            blocks_found: stat.blocks_found
          })),
          total: poolStats.length,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(`Error getting database pool stats: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Overall share statistics
    this.app.get('/api/shares/stats/overall', async (req, res) => {
      try {
        const shareStats = await this.database.getTotalShareStats();

        res.json({
          total_shares: shareStats.total_shares || 0,
          valid_shares: shareStats.valid_shares || 0,
          rejected_shares: shareStats.rejected_shares || 0,
          blocks_found: shareStats.blocks_found || 0,
          acceptance_rate: shareStats.total_shares > 0 ?
            ((shareStats.valid_shares / shareStats.total_shares) * 100).toFixed(2) : 0,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(`Error getting overall share stats: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Daemon status
    this.app.get('/api/daemon/status', async (req, res) => {
      try {
        const daemonConfig = this.config.getDaemonConfig();
        const daemonStatus = await this.getDaemonStatus(daemonConfig);

        res.json({
          daemon: daemonStatus,
          pool: {
            connected: daemonStatus.connected,
            lastCheck: new Date().toISOString(),
          },
        });
      } catch (error) {
        logger.error(`Error getting daemon status: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Force template update
    this.app.post('/api/template/update', async (req, res) => {
      try {
        await this.blockTemplateManager.forceUpdate();

        res.json({
          success: true,
          message: 'Template update initiated',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(`Error updating template: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Test daemon connection
    this.app.get('/api/test-daemon', async (req, res) => {
      try {
        const daemonConfig = this.config.getDaemonConfig();
        logger.info(`Testing daemon connection to: ${daemonConfig.url}`);

        const daemonStatus = await this.getDaemonStatus(daemonConfig);

        // Also try to get a template
        let templateResult = null;
        try {
          templateResult = await this.blockTemplateManager.getRealTemplateFromDaemon(daemonConfig);
        } catch (templateError) {
          templateResult = { error: templateError.message };
        }

        res.json({
          daemon: daemonStatus,
          template: templateResult,
          config: {
            url: daemonConfig.url,
            hasApiKey: !!daemonConfig.apiKey,
            hasAuth: !!(daemonConfig.username && daemonConfig.password),
            timeout: daemonConfig.timeout,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(`Error testing daemon: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Reset statistics
    this.app.post('/api/stats/reset', (req, res) => {
      try {
        this.shareValidator.resetStats();
        this.stats = {
          startTime: Date.now(),
          totalShares: 0,
          validShares: 0,
          invalidShares: 0,
          blocksFound: 0,
          lastBlockFound: null,
        };

        res.json({
          success: true,
          message: 'Statistics reset successfully',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(`Error resetting stats: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Found blocks
    this.app.get('/api/blocks', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const blocks = await this.database.getBlocks(limit, offset);

        res.json({
          blocks: blocks.map(block => ({
            height: block.height,
            hash: block.hash,
            previous_hash: block.previous_hash,
            merkle_root: block.merkle_root,
            timestamp: block.timestamp,
            nonce: block.nonce,
            difficulty: block.difficulty,
            found_by: block.found_by,
            status: block.status,
            created_at: block.created_at
          })),
          count: blocks.length,
          pagination: {
            limit,
            offset,
            total: blocks.length
          },
          timestamp: new Date().toISOString(),
          blockExplorer: this.config.get('pool.blockExplorer') || 'http://127.0.0.1:3004'
        });
      } catch (error) {
        logger.error(`Error getting blocks: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get specific block by height
    this.app.get('/api/blocks/:height', async (req, res) => {
      try {
        const height = parseInt(req.params.height);
        if (isNaN(height)) {
          return res.status(400).json({ error: 'Invalid height parameter' });
        }

        const block = await this.database.getBlockByHeight(height);
        if (!block) {
          return res.status(404).json({ error: 'Block not found' });
        }

        res.json({
          height: block.height,
          hash: block.hash,
          previous_hash: block.previous_hash,
          merkle_root: block.merkle_root,
          timestamp: block.timestamp,
          nonce: block.nonce,
          difficulty: block.difficulty,
          found_by: block.found_by,
          status: block.status,
          created_at: block.created_at
        });
      } catch (error) {
        logger.error(`Error getting block ${req.params.height}: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Payment history endpoint
    this.app.get('/api/payments', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const minerAddress = req.query.address;

        const payments = await this.paymentProcessor.getPaymentHistory(minerAddress, limit, offset);
        const stats = await this.paymentProcessor.getPaymentStats();

        res.json({
          payments: payments.map(payment => ({
            id: payment.id,
            batchId: payment.batch_id,
            txId: payment.transaction_id || '',
            address: payment.miner_address || '',
            amount: fromAtomicUnits(payment.amount_atomic || 0),
            fee: fromAtomicUnits(payment.fee_atomic || 0),
            netAmount: fromAtomicUnits(payment.net_amount_atomic || 0),
            status: payment.status || 'unknown',
            errorMessage: payment.error_message,
            paymentType: payment.payment_type || 'auto',
            timestamp: payment.created_at || Date.now(),
            confirmedAt: payment.confirmed_at
          })),
          stats: stats,
          count: payments.length,
          timestamp: new Date().toISOString(),
          blockExplorer: this.config.get('pool.blockExplorer') || 'http://127.0.0.1:3004'
        });
      } catch (error) {
        logger.error(`Error getting payments: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Payment stats endpoint
    this.app.get('/api/payments/stats', async (req, res) => {
      try {
        const stats = await this.paymentProcessor.getPaymentStats();
        res.json({
          success: true,
          data: stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Error getting payment stats: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Enhanced pool analytics endpoint
    this.app.get('/api/analytics', async (req, res) => {
      try {
        const timeRange = req.query.range || '24h'; // 1h, 6h, 24h, 7d, 30d
        const now = Date.now();
        const ranges = {
          '1h': 60 * 60 * 1000,
          '6h': 6 * 60 * 60 * 1000,
          '24h': 24 * 60 * 60 * 1000,
          '7d': 7 * 24 * 60 * 60 * 1000,
          '30d': 30 * 24 * 60 * 60 * 1000,
        };
        const startTime = now - (ranges[timeRange] || ranges['24h']);

        // Get time-series data for the requested range
        const [poolStats, shareHistory, hashrateHistory, minerActivity, totalShareStats, totalBlocks] = await Promise.all([
          this.database.getPoolStatsInRange ? this.database.getPoolStatsInRange(startTime, now) : [],
          this.database.getSharesInRange ? this.database.getSharesInRange(startTime, now) : [],
          this.database.getHashrateHistory ? this.database.getHashrateHistory(startTime, now) : [],
          this.database.getMinerActivity ? this.database.getMinerActivity(startTime, now) : [],
          this.database.getTotalShareStats(),
          this.database.getBlocks(50)
        ]);

        // Current stats
        const currentStats = this.shareValidator.getStats();
        const stratumStats = this.stratumServer.getStats();
        const totalHashrate = this.stratumServer.calculateTotalHashrate();
        const template = this.blockTemplateManager.getCurrentTemplate();

        // Calculate metrics over time period
        const totalSharesInPeriod = shareHistory.length;
        const validSharesInPeriod = shareHistory.filter(s => s.is_valid === 1).length;
        const blocksFoundInPeriod = shareHistory.filter(s => s.is_block === 1).length;
        
        // Use database stats for total blocks found (persistent across restarts)
        const totalBlocksFound = totalShareStats?.blocks_found || totalBlocks.length || 0;
        
        // Calculate pool efficiency (percentage of valid shares)
        const poolEfficiency = totalShareStats?.total_shares > 0 ? 
          ((totalShareStats.valid_shares / totalShareStats.total_shares) * 100).toFixed(2) : 0;

        // 🎯 VELORA-SPECIFIC NETWORK HASHRATE CALCULATION
        // Calibrated for Velora algorithm based on actual mining data
        const blockTime = this.config.get('mining.blockTime') || 60; // Still needed for API responses
        const networkDifficulty = template?.difficulty || 0;
        const hashratePerDifficulty = 0.24; // H/s per difficulty unit (tuned for Velora)
        const networkHashrate = networkDifficulty > 0 ? (networkDifficulty * hashratePerDifficulty) : 0;
        
        // Calculate network share percentage
        const networkShare = networkHashrate > 0 && totalHashrate > 0 ? 
          ((totalHashrate / networkHashrate) * 100).toFixed(4) : 0;
        
        // Hashrate trend calculation
        const hashratePoints = hashrateHistory.length > 0 ? hashrateHistory : 
          [{ timestamp: startTime, hashrate: 0 }, { timestamp: now, hashrate: totalHashrate }];

        res.json({
          timeRange: timeRange,
          period: {
            start: startTime,
            end: now,
            duration: ranges[timeRange] || ranges['24h']
          },
          current: {
            hashrate: totalHashrate,
            miners: stratumStats.activeConnections,
            difficulty: networkDifficulty,
            uptime: process.uptime(),
            efficiency: poolEfficiency,
            blocksFound: totalBlocksFound,
            networkHashrate: networkHashrate,
            networkShare: parseFloat(networkShare)
          },
          historical: {
            shares: {
              total: totalSharesInPeriod,
              valid: validSharesInPeriod,
              invalid: totalSharesInPeriod - validSharesInPeriod,
              efficiency: totalSharesInPeriod > 0 ? (validSharesInPeriod / totalSharesInPeriod * 100).toFixed(2) : 0
            },
            blocks: {
              found: blocksFoundInPeriod,
              totalFound: totalBlocksFound,
              rate: blocksFoundInPeriod / (ranges[timeRange] / (60 * 60 * 1000)) // blocks per hour
            },
            hashrate: {
              points: hashratePoints,
              average: hashratePoints.reduce((sum, point) => sum + (point.hashrate || 0), 0) / hashratePoints.length,
              peak: Math.max(...hashratePoints.map(p => p.hashrate || 0))
            },
            miners: {
              unique: [...new Set(shareHistory.map(s => s.miner_id))].length,
              activity: minerActivity
            },
            network: {
              hashrate: networkHashrate,
              difficulty: networkDifficulty,
              blockTime: blockTime,
              poolShare: parseFloat(networkShare)
            }
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Error getting analytics: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Network statistics endpoint with 15-second caching
    this.app.get('/api/network', async (req, res) => {
      try {
        const networkData = await this.getCachedNetworkData();
        res.json(networkData);
      } catch (error) {
        logger.error(`Error getting network stats: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Miner leaderboard endpoint with database persistence
    this.app.get('/api/leaderboard', async (req, res) => {
      try {
        const timeRange = req.query.range || '24h';
        const limit = parseInt(req.query.limit) || 20;
        
        // Try to get from database first for persistent leaderboard
        let leaderboard = await this.database.getLeaderboard(limit);
        
        // If no persistent data or requesting fresh data, build from active miners
        if (leaderboard.length === 0 || req.query.fresh === 'true') {
          const miners = await this.database.getMiners();
          const currentHashrateData = await this.stratumServer.clients ? 
            Array.from(this.stratumServer.clients.values()).filter(c => c.authorized) : [];

          const tempLeaderboard = await Promise.all(
            miners.slice(0, limit).map(async (miner) => {
              const shareStats = await this.database.getMinerShareStats(miner.id);
              const realtimeClient = currentHashrateData.find(c => c.address === miner.address);
              const avgHashrates = await this.database.calculateMinerAverageHashrates(miner.address);
              
              return {
                rank: 0, // Will be set after sorting
                address: miner.address,
                workerName: miner.worker_name,
                hashrate: realtimeClient?.hashrate || miner.hashrate || 0,
                avgHashrate1h: avgHashrates.avg_hashrate_1h,
                avgHashrate3h: avgHashrates.avg_hashrate_3h,
                avgHashrate24h: avgHashrates.avg_hashrate_24h,
                shares: {
                  total: shareStats.total_shares || 0,
                  valid: shareStats.valid_shares || 0,
                  rejected: shareStats.rejected_shares || 0,
                  efficiency: shareStats.total_shares > 0 ? 
                    ((shareStats.valid_shares / shareStats.total_shares) * 100).toFixed(2) : 0
                },
                blocks: shareStats.blocks_found || 0,
                lastSeen: miner.last_seen,
                isOnline: realtimeClient ? true : false,
                joinedAt: miner.created_at
              };
            })
          );

          // Sort by hashrate and assign ranks
          tempLeaderboard.sort((a, b) => b.hashrate - a.hashrate);
          tempLeaderboard.forEach((miner, index) => {
            miner.rank = index + 1;
          });
          
          leaderboard = tempLeaderboard;
        } else {
          // Format persistent leaderboard data for response
          leaderboard = leaderboard.map((miner, index) => ({
            rank: index + 1,
            address: miner.address,
            workerName: `${miner.address.substring(0, 8)}...${miner.address.substring(miner.address.length - 6)}`,
            hashrate: miner.total_hashrate,
            avgHashrate1h: miner.avg_hashrate_1h,
            avgHashrate3h: miner.avg_hashrate_3h,
            avgHashrate24h: miner.avg_hashrate_24h,
            shares: {
              total: miner.total_shares,
              valid: miner.valid_shares,
              rejected: miner.rejected_shares,
              efficiency: miner.total_shares > 0 ? 
                ((miner.valid_shares / miner.total_shares) * 100).toFixed(2) : 0
            },
            blocks: miner.blocks_found,
            lastSeen: miner.last_active,
            isOnline: (Date.now() - miner.last_active) < 300000, // 5 minutes threshold
            joinedAt: miner.first_seen,
            confirmedBalance: fromAtomicUnits(miner.confirmed_balance || 0),
            unconfirmedBalance: fromAtomicUnits(miner.unconfirmed_balance || 0),
            totalPaid: fromAtomicUnits(miner.total_paid || 0)
          }));
        }

        res.json({
          leaderboard,
          timeRange,
          totalMiners: leaderboard.length,
          onlineMiners: leaderboard.filter(m => m.isOnline).length,
          timestamp: new Date().toISOString(),
          isPersistent: req.query.fresh !== 'true'
        });
      } catch (error) {
        logger.error(`Error getting leaderboard: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Pool performance metrics
    this.app.get('/api/performance', (req, res) => {
      try {
        const stratumStats = this.stratumServer.getStats();
        const shareStats = this.shareValidator.getStats();
        const uptime = process.uptime();
        const memUsage = process.memoryUsage();

        // Calculate performance metrics
        const avgSharesPerMinute = shareStats.totalShares / (uptime / 60);
        const avgBlockTime = shareStats.blocksFound > 0 ? uptime / shareStats.blocksFound : 0;
        const connectionRate = stratumStats.totalConnections / (uptime / 3600); // connections per hour

        res.json({
          pool: {
            uptime: uptime,
            startTime: Date.now() - (uptime * 1000),
            version: this.config.get('pool.version'),
            algorithm: this.config.get('mining.algorithm')
          },
          performance: {
            sharesPerMinute: avgSharesPerMinute.toFixed(2),
            avgBlockTime: avgBlockTime,
            connectionRate: connectionRate.toFixed(2),
            efficiency: shareStats.validShareRate || 0,
            rejectionRate: shareStats.totalShares > 0 ? 
              ((shareStats.invalidShares / shareStats.totalShares) * 100).toFixed(2) : 0
          },
          server: {
            memory: {
              used: Math.round(memUsage.heapUsed / 1024 / 1024),
              total: Math.round(memUsage.heapTotal / 1024 / 1024),
              external: Math.round(memUsage.external / 1024 / 1024),
              rss: Math.round(memUsage.rss / 1024 / 1024)
            },
            cpu: {
              usage: process.cpuUsage()
            },
            connections: {
              active: stratumStats.activeConnections,
              total: stratumStats.totalConnections,
              jobs: stratumStats.jobs || 0
            }
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Error getting performance metrics: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Recent activity feed
    this.app.get('/api/activity', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const activities = [];

        // Get recent shares
        const recentShares = await this.database.getShares ? 
          await this.database.getShares(20, 0) : [];
        
        // Get recent blocks
        const recentBlocks = await this.database.getBlocks(10, 0);

        // Convert shares to activity items
        recentShares.forEach(share => {
          activities.push({
            type: share.is_block === 1 ? 'block_found' : 'share_submitted',
            timestamp: share.timestamp,
            miner: share.worker_name || 'Anonymous',
            description: share.is_block === 1 ? 
              `Block found at height ${share.height || 'unknown'}!` : 
              `Share submitted (difficulty: ${share.difficulty})`,
            data: {
              difficulty: share.difficulty,
              isValid: share.is_valid === 1,
              isBlock: share.is_block === 1,
              minerId: share.miner_id
            }
          });
        });

        // Convert blocks to activity items
        recentBlocks.forEach(block => {
          activities.push({
            type: 'block_found',
            timestamp: block.created_at || block.timestamp,
            miner: block.found_by || 'Unknown',
            description: `Block found at height ${block.height}`,
            data: {
              height: block.height,
              hash: block.hash,
              difficulty: block.difficulty,
              status: block.status
            }
          });
        });

        // Sort by timestamp and limit
        activities.sort((a, b) => b.timestamp - a.timestamp);
        const limitedActivities = activities.slice(0, limit);

        res.json({
          activities: limitedActivities,
          count: limitedActivities.length,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error(`Error getting activity feed: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Favicon
    this.app.get('/favicon.ico', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/favicon.ico'));
    });

    // Catch-all for SPA
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });
  }

  /**
   * Get daemon status
   */
  async getDaemonStatus(daemonConfig) {
    try {
      const { url, apiKey, username, password } = daemonConfig;

      if (!url) {
        return { connected: false, error: 'Daemon URL not configured' };
      }

      // Prepare headers
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Pastella-Mining-Pool/1.0.0',
      };

      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      } else if (username && password) {
        const auth = Buffer.from(`${username}:${password}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
      }

      // Check daemon health
      const response = await axios.get(`${url}/api/health`, {
        headers,
        timeout: 10000,
      });

      if (response.status === 200) {
        return {
          connected: true,
          url: url,
          status: response.data.status,
          uptime: response.data.uptime,
        };
      } else {
        return {
          connected: false,
          error: `Daemon returned status ${response.status}`,
        };
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        return { connected: false, error: 'Cannot connect to daemon' };
      } else if (error.code === 'ETIMEDOUT') {
        return { connected: false, error: 'Daemon request timed out' };
      } else {
        return { connected: false, error: error.message };
      }
    }
  }

  /**
   * Get cached network data with 15-second TTL
   */
  async getCachedNetworkData() {
    const now = Date.now();
    
    // Return cached data if still valid
    if (this.networkCache.data && (now - this.networkCache.timestamp) < this.networkCache.ttl) {
      return this.networkCache.data;
    }

    try {
      const template = this.blockTemplateManager.getCurrentTemplate();
      const daemonConfig = this.config.getDaemonConfig();
      const daemonStatus = await this.getDaemonStatus(daemonConfig);
      const totalHashrate = this.stratumServer.calculateTotalHashrate();
      const totalShareStats = await this.database.getTotalShareStats();

      // 🎯 VELORA-SPECIFIC NETWORK HASHRATE CALCULATION
      const blockTime = this.config.get('mining.blockTime') || 60;
      const networkDifficulty = template?.difficulty || 0;
      const hashratePerDifficulty = 0.24; // H/s per difficulty unit (tuned for Velora)
      const networkHashrate = networkDifficulty > 0 ? (networkDifficulty * hashratePerDifficulty) : 0;
      
      // Calculate pool's share of network hashrate
      const poolPercentage = networkHashrate > 0 && totalHashrate > 0 ? 
        ((totalHashrate / networkHashrate) * 100).toFixed(4) : '0.0000';
      
      // Pool efficiency from database stats
      const poolEfficiency = totalShareStats?.total_shares > 0 ? 
        ((totalShareStats.valid_shares / totalShareStats.total_shares) * 100).toFixed(2) : '0.00';

      // Get additional network info from daemon if available
      let networkInfo = {};
      if (daemonStatus.connected) {
        try {
          const networkResponse = await axios.get(`${daemonConfig.url}/api/blockchain/status`, {
            headers: daemonConfig.apiKey ? { 'X-API-Key': daemonConfig.apiKey } : {},
            timeout: 5000
          });
          networkInfo = networkResponse.data;
        } catch (error) {
          logger.warn(`Failed to get network info: ${error.message}`);
        }
      }

      // Create the network data object
      const networkData = {
        daemon: {
          connected: daemonStatus.connected,
          url: daemonConfig.url,
          status: daemonStatus.status,
          error: daemonStatus.error
        },
        blockchain: {
          height: template?.index || networkInfo.height || 0,
          difficulty: networkDifficulty,
          blockTime: blockTime,
          lastBlock: template?.timestamp || networkInfo.lastBlock || null,
          pendingTransactions: template?.transactions?.length || 0
        },
        pool: {
          hashrate: totalHashrate,
          miners: this.stratumServer.getStats().activeConnections,
          efficiency: parseFloat(poolEfficiency),
          blocksFound: totalShareStats?.blocks_found || 0,
          networkHashrate: networkHashrate,
          poolPercentage: parseFloat(poolPercentage)
        },
        network: {
          hashrate: networkHashrate,
          difficulty: networkDifficulty,
          blockTime: blockTime,
          algorithm: this.config.get('mining.algorithm')
        },
        timestamp: new Date().toISOString()
      };

      // Update cache
      this.networkCache.data = networkData;
      this.networkCache.timestamp = now;
      
      return networkData;
    } catch (error) {
      logger.error(`Error getting cached network data: ${error.message}`);
      // Return cached data if available, even if expired
      if (this.networkCache.data) {
        return this.networkCache.data;
      }
      throw error;
    }
  }

  /**
   * Start the mining pool
   */
  async start() {
    try {
      // Validate configuration
      const validation = this.config.validate();
      if (!validation.valid) {
        throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
      }

      // Initialize database
      await this.database.initialize();
      logger.info('Database initialized');

      // Clear miners on startup (they are connection-specific, not persistent)
      await this.database.clearMiners();

      // Start HTTP server (guard against double-start and add clear error handling)
      const { port, host } = this.config.getComponentConfig('http');

      if (this.server) {
        logger.warn(`HTTP server already running, refusing to start again on ${host}:${port}`);
      } else {
        this.server = this.app.listen(port, host, () => {
          this.isRunning = true;
          logger.info(`Web dashboard available at http://${host}:${port}`);
        });

        this.server.on('error', (err) => {
          if (err && err.code === 'EADDRINUSE') {
            logger.error(`HTTP port already in use: ${host}:${port}. Change 'http.port' in config/pool.json or stop the process using it.`);
          } else if (err) {
            logger.error(`HTTP server error: ${err.message}`);
          }
        });
      }

      // Start Stratum server
      this.stratumServer.start();
      logger.info('Stratum server started');
      logger.info('Mining pool ready for connections');

      // Start statistics updates
      this.startStatisticsUpdates();

      // Start payment processor
      this.paymentProcessor.start();
      logger.info('Payment processor started');

      return true;
    } catch (error) {
      logger.error(`Failed to start mining pool: ${error.message}`);
      return false;
    }
  }

  /**
   * Stop the mining pool
   */
  async stop() {
    try {
      this.isRunning = false;

      // Stop HTTP server
      if (this.server) {
        this.server.close();
        this.server = null;
      }

      // Stop Stratum server
      this.stratumServer.stop();

      // Stop payment processor
      this.paymentProcessor.stop();

      // Close database
      await this.database.close();

      logger.info('Mining pool stopped successfully');
      return true;
    } catch (error) {
      logger.error(`Error stopping mining pool: ${error.message}`);
      return false;
    }
  }

  /**
   * Start statistics updates
   */
  startStatisticsUpdates() {
    setInterval(() => {
      this.updateStatistics();
    }, 30000); // Update every 30 seconds

    // Update miner hashrates in database every minute
    setInterval(async () => {
      if (this.stratumServer) {
        await this.stratumServer.updateMinerHashratesInDatabase();
      }
    }, 60000); // Update every minute

    // Clean up offline miners every 5 minutes
    setInterval(async () => {
      try {
        await this.database.removeOfflineMiners(10); // Remove miners offline for 10+ minutes
      } catch (error) {
        logger.error(`Error cleaning up offline miners: ${error.message}`);
      }
    }, 300000); // Clean up every 5 minutes

    // Update leaderboard data in database every 2 minutes
    setInterval(async () => {
      try {
        await this.updateLeaderboardDatabase();
      } catch (error) {
        logger.error(`Error updating leaderboard database: ${error.message}`);
      }
    }, 120000); // Update every 2 minutes

    // Save miner stats history for persistence every 5 minutes
    setInterval(async () => {
      try {
        await this.saveMinerStatsHistory();
      } catch (error) {
        logger.error(`Error saving miner stats history: ${error.message}`);
      }
    }, 300000); // Update every 5 minutes

    // Update miner balances (confirm blocks) every 2 minutes
    setInterval(async () => {
      try {
        await this.updateMinerBalances();
      } catch (error) {
        logger.error(`Error updating miner balances: ${error.message}`);
      }
    }, 120000); // Update every 2 minutes
  }

  /**
   * Update pool statistics
   */
  updateStatistics() {
    try {
      const shareStats = this.shareValidator.getStats();
      const stratumStats = this.stratumServer.getStats();

      this.stats.totalShares = shareStats.totalShares;
      this.stats.validShares = shareStats.validShares;
      this.stats.invalidShares = shareStats.invalidShares;
      this.stats.blocksFound = shareStats.blocksFound;
      this.stats.lastBlockFound = shareStats.lastBlockFound;

      logger.debug(
        'Pool',
        `Statistics updated - Shares: ${this.stats.validShares}/${this.stats.totalShares}, Blocks: ${this.stats.blocksFound}`
      );
    } catch (error) {
      logger.error(`Error updating statistics: ${error.message}`);
    }
  }

  /**
   * Update leaderboard data in database for persistence
   */
  async updateLeaderboardDatabase() {
    try {
      const miners = await this.database.getMiners();
      const currentHashrateData = await this.stratumServer.clients ? 
        Array.from(this.stratumServer.clients.values()).filter(c => c.authorized) : [];

      for (const miner of miners) {
        try {
          const shareStats = await this.database.getMinerShareStats(miner.id);
          const realtimeClient = currentHashrateData.find(c => c.address === miner.address);
          const avgHashrates = await this.database.calculateMinerAverageHashrates(miner.address);
          
          // Count workers for this address
          const workersForAddress = miners.filter(m => m.address === miner.address);
          
          const leaderboardStats = {
            worker_count: workersForAddress.length,
            total_hashrate: realtimeClient?.hashrate || miner.hashrate || 0,
            avg_hashrate_1h: avgHashrates.avg_hashrate_1h,
            avg_hashrate_3h: avgHashrates.avg_hashrate_3h,
            avg_hashrate_24h: avgHashrates.avg_hashrate_24h,
            total_shares: shareStats.total_shares || 0,
            valid_shares: shareStats.valid_shares || 0,
            rejected_shares: shareStats.rejected_shares || 0,
            blocks_found: shareStats.blocks_found || 0,
            confirmed_balance: await this.database.calculateConfirmedBalance(miner.address),
            unconfirmed_balance: await this.database.calculateUnconfirmedBalance(miner.address),
            total_paid: await this.calculateTotalPaid(miner.address),
            last_active: realtimeClient ? Date.now() : miner.last_seen
          };

          await this.database.updateLeaderboard(miner.address, leaderboardStats);
        } catch (error) {
          logger.error(`Error updating leaderboard for miner ${miner.address}: ${error.message}`);
        }
      }

      logger.debug(`Leaderboard database updated for ${miners.length} miners`);
    } catch (error) {
      logger.error(`Error in updateLeaderboardDatabase: ${error.message}`);
    }
  }

  /**
   * Save miner stats history for persistent display
   */
  async saveMinerStatsHistory() {
    try {
      const miners = await this.database.getMiners();
      const currentHashrateData = await this.stratumServer.clients ? 
        Array.from(this.stratumServer.clients.values()).filter(c => c.authorized) : [];

      // Group miners by address to avoid duplicates
      const minersByAddress = {};
      for (const miner of miners) {
        if (!minersByAddress[miner.address]) {
          minersByAddress[miner.address] = [];
        }
        minersByAddress[miner.address].push(miner);
      }

      for (const [address, addressMiners] of Object.entries(minersByAddress)) {
        try {
          const shareStats = await this.database.getMinerShareStats(addressMiners[0].id);
          const realtimeClients = currentHashrateData.filter(c => c.address === address);
          
          const totalHashrate = realtimeClients.reduce((sum, client) => sum + (client.hashrate || 0), 0) ||
                               addressMiners.reduce((sum, miner) => sum + (miner.hashrate || 0), 0);

          const statsData = {
            hashrate: totalHashrate,
            shares_submitted: shareStats.total_shares || 0,
            shares_accepted: shareStats.valid_shares || 0,
            shares_rejected: shareStats.rejected_shares || 0,
            workers_online: realtimeClients.length
          };

          await this.database.addMinerStatsHistory(address, statsData);
        } catch (error) {
          logger.error(`Error saving stats history for miner ${address}: ${error.message}`);
        }
      }

      logger.debug(`Miner stats history saved for ${Object.keys(minersByAddress).length} addresses`);
    } catch (error) {
      logger.error(`Error in saveMinerStatsHistory: ${error.message}`);
    }
  }

  
  /**
   * Calculate total amount paid to a miner
   * This would come from a payouts table in a full implementation
   */
  async calculateTotalPaid(address) {
    try {
      // Get total paid from leaderboard table (stored in atomic units)
      const leaderboardData = await this.database.get(
        'SELECT total_paid FROM leaderboard WHERE address = ?',
        [address]
      );

      return leaderboardData ? leaderboardData.total_paid : 0;
    } catch (error) {
      logger.error(`Error calculating total paid for ${address}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get block confirmation status based on current network height
   */
  getBlockStatus(blockHeight) {
    try {
      const currentTemplate = this.blockTemplateManager.getCurrentTemplate();
      if (!currentTemplate || !currentTemplate.index) {
        return 'pending';
      }
      
      const currentHeight = currentTemplate.index;
      const confirmationsNeeded = 10; // Standard confirmation requirement
      const confirmations = currentHeight - blockHeight;
      
      if (confirmations >= confirmationsNeeded) {
        return 'confirmed';
      } else if (confirmations > 0) {
        return `confirming (${confirmations}/${confirmationsNeeded})`;
      } else {
        return 'pending';
      }
    } catch (error) {
      logger.error(`Error determining block status for height ${blockHeight}: ${error.message}`);
      return 'pending';
    }
  }

  /**
   * Update miner balances based on confirmed blocks
   * Move rewards from unconfirmed to confirmed when blocks reach 10 confirmations
   * This method recalculates balances from scratch to avoid double-confirmation issues
   */
  async updateMinerBalances() {
    try {
      const currentTemplate = this.blockTemplateManager.getCurrentTemplate();
      if (!currentTemplate || !currentTemplate.index) {
        return;
      }
      
      const currentHeight = currentTemplate.index;
      const confirmationsNeeded = 10;

      // First, update block statuses based on confirmations
      const unconfirmedBlocks = await this.database.all(`
        SELECT height, status FROM blocks
        WHERE status IN ('found', 'pending', 'confirming')
      `);

      for (const block of unconfirmedBlocks) {
        const confirmations = currentHeight - block.height;
        let newStatus = block.status;

        if (confirmations >= confirmationsNeeded) {
          newStatus = 'confirmed';
        } else if (confirmations > 0) {
          newStatus = 'confirming';
        } else {
          newStatus = 'pending';
        }

        if (newStatus !== block.status) {
          await this.database.updateBlockStatus(block.height, newStatus);
          logger.debug(`Updated block ${block.height} status: ${block.status} -> ${newStatus} (${confirmations}/${confirmationsNeeded} confirmations)`);
        }
      }

      // Get all miners with block rewards
      const miners = await this.database.all(`
        SELECT DISTINCT miner_address FROM block_rewards
      `);
      
      const { toAtomicUnits } = require('./utils/atomicUnits.js');
      
      for (const miner of miners) {
        // Get all rewards for this miner
        const rewards = await this.database.all(`
          SELECT block_height, miner_reward 
          FROM block_rewards 
          WHERE miner_address = ?
          ORDER BY block_height
        `, [miner.miner_address]);
        
        // Calculate correct confirmed and unconfirmed balances
        let confirmedBalance = 0;
        let unconfirmedBalance = 0;
        
        for (const reward of rewards) {
          const confirmations = currentHeight - reward.block_height;
          if (confirmations >= confirmationsNeeded) {
            confirmedBalance += reward.miner_reward;
          } else {
            unconfirmedBalance += reward.miner_reward;
          }
        }
        
        // Update the leaderboard with correct balances (atomic units)
        const confirmedAtomic = toAtomicUnits(confirmedBalance);
        const unconfirmedAtomic = toAtomicUnits(unconfirmedBalance);
        
        await this.database.run(`
          UPDATE leaderboard 
          SET confirmed_balance = ?, unconfirmed_balance = ?
          WHERE address = ?
        `, [confirmedAtomic, unconfirmedAtomic, miner.miner_address]);
        
        logger.debug(`Updated balances for ${miner.miner_address}: ${confirmedBalance} confirmed, ${unconfirmedBalance} unconfirmed`);
      }
    } catch (error) {
      logger.error(`Error updating miner balances: ${error.message}`);
    }
  }

  /**
   * Get pool information
   */
  getPoolInfo() {
    return {
      name: this.config.get('pool.name'),
      version: this.config.get('pool.version'),
      algorithm: this.config.get('mining.algorithm'),
      fee: this.config.get('pool.fee'),
      minPayout: this.config.get('pool.minPayout'),
      uptime: process.uptime(),
      isRunning: this.isRunning,
    };
  }
}

module.exports = MiningPool;
