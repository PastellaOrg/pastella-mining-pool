const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');

// Import components
const ConfigManager = require('./config/config-manager.js');
const DatabaseManager = require('./database/database-manager.js');
const BlockTemplateManager = require('./mining/block-template-manager.js');
const ShareValidator = require('./mining/share-validator.js');
const StratumServer = require('./stratum/stratum-server.js');
const logger = require('./utils/logger.js');

class MiningPool {
  constructor() {
    this.config = new ConfigManager();
    this.database = new DatabaseManager(this.config);
    this.blockTemplateManager = new BlockTemplateManager(this.config);
    this.shareValidator = new ShareValidator(this.config, this.blockTemplateManager);
    this.stratumServer = new StratumServer(this.config);

    // Set up component connections
    this.stratumServer.setShareValidator(this.shareValidator);
    this.stratumServer.setBlockTemplateManager(this.blockTemplateManager);
    this.stratumServer.setDatabaseManager(this.database);

    // Set database manager for share validator
    this.shareValidator.setDatabaseManager(this.database);

    // Express app
    this.app = express();
    this.server = null;
    this.isRunning = false;

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
      logger.debug(`${req.method} ${req.path} from ${req.ip}`);
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
    this.app.get('/api/status', (req, res) => {
      try {
        const template = this.blockTemplateManager.getTemplateInfo();
        const stratumStats = this.stratumServer.getStats();
        const shareStats = this.shareValidator.getStats();

        const status = {
          pool: {
            name: this.config.get('pool.name'),
            version: this.config.get('pool.version'),
            algorithm: this.config.get('mining.algorithm'),
            fee: this.config.get('pool.fee'),
            minPayout: this.config.get('pool.minPayout'),
          },
          mining: {
            template: template,
            poolDifficulty: template.available ? template.poolDifficulty : 0,
            blockDifficulty: template.available ? template.difficulty : 0,
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

    // Block template
    this.app.get('/api/block-template', (req, res) => {
      try {
        const template = this.blockTemplateManager.getTemplateInfo();
        res.json(template);
      } catch (error) {
        logger.error(`Error getting block template: ${error.message}`);
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

    // Payment history
    this.app.get('/api/payments', (req, res) => {
      try {
        // For now, return empty array since we haven't implemented payment processing yet
        // In a real implementation, this would query the database for payment history
        res.json({
          payments: [],
          count: 0,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(`Error getting payments: ${error.message}`);
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

        // Calculate network hashrate using current difficulty and block time
        const blockTime = this.config.get('mining.blockTime') || 60; // seconds
        const networkDifficulty = template?.difficulty || 0;
        const networkHashrate = networkDifficulty > 0 ? (networkDifficulty / blockTime) : 0;
        
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

    // Network statistics endpoint
    this.app.get('/api/network', async (req, res) => {
      try {
        const template = this.blockTemplateManager.getCurrentTemplate();
        const daemonConfig = this.config.getDaemonConfig();
        const daemonStatus = await this.getDaemonStatus(daemonConfig);
        const totalHashrate = this.stratumServer.calculateTotalHashrate();
        const totalShareStats = await this.database.getTotalShareStats();

        // Calculate network hashrate using difficulty and block time from config
        const blockTime = this.config.get('mining.blockTime') || 60; // seconds
        const networkDifficulty = template?.difficulty || 0;
        const networkHashrate = networkDifficulty > 0 ? (networkDifficulty / blockTime) : 0;
        
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

        res.json({
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
        });
      } catch (error) {
        logger.error(`Error getting network stats: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Miner leaderboard endpoint
    this.app.get('/api/leaderboard', async (req, res) => {
      try {
        const timeRange = req.query.range || '24h';
        const limit = parseInt(req.query.limit) || 20;
        
        // Get all miners with their stats
        const miners = await this.database.getMiners();
        const currentHashrateData = await this.stratumServer.clients ? 
          Array.from(this.stratumServer.clients.values()).filter(c => c.authorized) : [];

        const leaderboard = await Promise.all(
          miners.slice(0, limit).map(async (miner) => {
            const shareStats = await this.database.getMinerShareStats(miner.id);
            const realtimeClient = currentHashrateData.find(c => c.address === miner.address);
            
            return {
              rank: 0, // Will be set after sorting
              address: miner.address,
              workerName: miner.worker_name,
              hashrate: realtimeClient?.hashrate || miner.hashrate || 0,
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
        leaderboard.sort((a, b) => b.hashrate - a.hashrate);
        leaderboard.forEach((miner, index) => {
          miner.rank = index + 1;
        });

        res.json({
          leaderboard,
          timeRange,
          totalMiners: miners.length,
          onlineMiners: leaderboard.filter(m => m.isOnline).length,
          timestamp: new Date().toISOString()
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
      logger.info('Database initialized successfully');

      // Clear miners on startup (they are connection-specific, not persistent)
      await this.database.clearMiners();
      logger.info('Miners cleared from database (startup cleanup)');

      // Start HTTP server (guard against double-start and add clear error handling)
      const { port, host } = this.config.getComponentConfig('http');

      if (this.server) {
        logger.warn(`HTTP server already running, refusing to start again on ${host}:${port}`);
      } else {
        this.server = this.app.listen(port, host, () => {
          this.isRunning = true;
          logger.info(`HTTP server started on ${host}:${port}`);
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
      logger.info('Stratum server started successfully');

      // Start statistics updates
      this.startStatisticsUpdates();

      logger.info('Mining pool started successfully');
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
