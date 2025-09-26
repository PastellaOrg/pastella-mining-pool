const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('../utils/logger.js');
const { toAtomicUnits, fromAtomicUnits } = require('../utils/atomicUnits.js');

class DatabaseManager {
  constructor() {
    this.db = null;
    this.dbPath = path.join(__dirname, '../../data/pool.db');
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      require('fs').mkdirSync(dataDir, { recursive: true });

      this.db = new sqlite3.Database(this.dbPath, err => {
        if (err) {
          reject(err);
          return;
        }

        this.createTables()
          .then(() => resolve())
          .catch(reject);
      });
    });
  }

  async createTables() {
    const tables = [
      // Miners table
      `CREATE TABLE IF NOT EXISTS miners (
                id TEXT PRIMARY KEY,
                address TEXT NOT NULL,
                worker_name TEXT NOT NULL,
                hashrate REAL DEFAULT 0,
                shares INTEGER DEFAULT 0,
                last_seen INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT 0
            )`,

      // Shares table
      `CREATE TABLE IF NOT EXISTS shares (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                miner_id TEXT NOT NULL,
                worker_name TEXT NOT NULL,
                job_id TEXT NOT NULL,
                extra_nonce2 TEXT NOT NULL,
                n_time TEXT NOT NULL,
                nonce TEXT NOT NULL,
                difficulty REAL NOT NULL,
                is_valid BOOLEAN DEFAULT 1,
                is_block BOOLEAN DEFAULT 0,
                timestamp INTEGER DEFAULT 0,
                FOREIGN KEY (miner_id) REFERENCES miners (id)
            )`,

      // Blocks table
      `CREATE TABLE IF NOT EXISTS blocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                height INTEGER UNIQUE NOT NULL,
                hash TEXT UNIQUE NOT NULL,
                previous_hash TEXT NOT NULL,
                merkle_root TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                nonce TEXT NOT NULL,
                difficulty REAL NOT NULL,
                found_by TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at INTEGER DEFAULT 0,
                FOREIGN KEY (found_by) REFERENCES miners (id)
            )`,

      // Pool stats table
      `CREATE TABLE IF NOT EXISTS pool_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                total_hashrate REAL DEFAULT 0,
                active_miners INTEGER DEFAULT 0,
                total_shares INTEGER DEFAULT 0,
                valid_shares INTEGER DEFAULT 0,
                invalid_shares INTEGER DEFAULT 0,
                blocks_found INTEGER DEFAULT 0,
                timestamp INTEGER DEFAULT 0
            )`,

      // Leaderboard table for persistent tracking
      `CREATE TABLE IF NOT EXISTS leaderboard (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                address TEXT NOT NULL,
                worker_count INTEGER DEFAULT 0,
                total_hashrate REAL DEFAULT 0,
                avg_hashrate_1h REAL DEFAULT 0,
                avg_hashrate_3h REAL DEFAULT 0,
                avg_hashrate_24h REAL DEFAULT 0,
                total_shares INTEGER DEFAULT 0,
                valid_shares INTEGER DEFAULT 0,
                rejected_shares INTEGER DEFAULT 0,
                blocks_found INTEGER DEFAULT 0,
                confirmed_balance BIGINT DEFAULT 0, -- atomic units
                unconfirmed_balance BIGINT DEFAULT 0, -- atomic units
                total_paid BIGINT DEFAULT 0, -- atomic units
                last_active INTEGER DEFAULT 0,
                first_seen INTEGER DEFAULT 0,
                updated_at INTEGER DEFAULT 0,
                UNIQUE(address)
            )`,

      // Miner stats history for detailed analytics
      `CREATE TABLE IF NOT EXISTS miner_stats_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                address TEXT NOT NULL,
                hashrate REAL DEFAULT 0,
                shares_submitted INTEGER DEFAULT 0,
                shares_accepted INTEGER DEFAULT 0,
                shares_rejected INTEGER DEFAULT 0,
                workers_online INTEGER DEFAULT 0,
                timestamp INTEGER DEFAULT 0
            )`,

      // Per-block rewards table for tracking individual block rewards
      `CREATE TABLE IF NOT EXISTS block_rewards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                block_height INTEGER NOT NULL,
                block_hash TEXT NOT NULL,
                miner_address TEXT NOT NULL,
                base_reward REAL NOT NULL,
                pool_fee REAL NOT NULL,
                miner_reward REAL NOT NULL,
                pool_hashrate REAL NOT NULL,
                miner_hashrate REAL NOT NULL,
                miner_percentage REAL NOT NULL,
                paid_out BOOLEAN DEFAULT 0,
                timestamp INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT 0,
                FOREIGN KEY (block_height) REFERENCES blocks (height),
                UNIQUE(block_height, miner_address)
            )`,

      // Payments table for tracking actual payments to miners
      `CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id TEXT NOT NULL,
                transaction_id TEXT NOT NULL,
                miner_address TEXT NOT NULL,
                amount_atomic BIGINT NOT NULL,
                fee_atomic BIGINT NOT NULL,
                net_amount_atomic BIGINT NOT NULL,
                status TEXT DEFAULT 'pending',
                error_message TEXT DEFAULT NULL,
                payment_type TEXT DEFAULT 'auto',
                created_at INTEGER DEFAULT 0,
                confirmed_at INTEGER DEFAULT 0,
                FOREIGN KEY (miner_address) REFERENCES leaderboard (address)
            )`,
    ];

    for (const table of tables) {
      await this.run(table);
    }

    // Create indexes for performance optimization
    const indexes = [
      // Critical indexes for balance calculation performance
      'CREATE INDEX IF NOT EXISTS idx_block_rewards_miner_address ON block_rewards (miner_address)',
      'CREATE INDEX IF NOT EXISTS idx_block_rewards_block_height ON block_rewards (block_height)',
      'CREATE INDEX IF NOT EXISTS idx_blocks_height ON blocks (height)',
      'CREATE INDEX IF NOT EXISTS idx_blocks_status ON blocks (status)',
      'CREATE INDEX IF NOT EXISTS idx_blocks_height_status ON blocks (height, status)',
      
      // Other performance indexes
      'CREATE INDEX IF NOT EXISTS idx_shares_miner_timestamp ON shares (miner_id, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_shares_timestamp_valid ON shares (timestamp, is_valid)',
      'CREATE INDEX IF NOT EXISTS idx_miners_address ON miners (address)',
      'CREATE INDEX IF NOT EXISTS idx_leaderboard_address ON leaderboard (address)',

      // Payment indexes for efficient queries
      'CREATE INDEX IF NOT EXISTS idx_payments_miner_address ON payments (miner_address)',
      'CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status)',
      'CREATE INDEX IF NOT EXISTS idx_payments_batch_id ON payments (batch_id)',
      'CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments (created_at)'
    ];

    for (const index of indexes) {
      await this.run(index);
    }

    // Add miner stats history indexes
    await this.run(`CREATE INDEX IF NOT EXISTS idx_miner_stats_address ON miner_stats_history(address)`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_miner_stats_timestamp ON miner_stats_history(timestamp)`);

    // Migration: Add paid_out column to existing block_rewards table if it doesn't exist
    try {
      await this.run(`ALTER TABLE block_rewards ADD COLUMN paid_out BOOLEAN DEFAULT 0`);
    } catch (error) {
      // Column already exists, ignore the error
      if (!error.message.includes('duplicate column name')) {
        throw error;
      }
    }

    // Migration: Add confirmations column to payments table for transaction validation
    try {
      await this.run(`ALTER TABLE payments ADD COLUMN confirmations INTEGER DEFAULT 0`);
    } catch (error) {
      // Column already exists, ignore the error
      if (!error.message.includes('duplicate column name')) {
        throw error;
      }
    }
  }

  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Miner management
  async addMiner(miner) {
    // ALWAYS use address.worker_name as the consistent composite key
    const workerId = `${miner.address}.${miner.worker_name}`;
    
    const sql = `INSERT OR REPLACE INTO miners
                     (id, address, worker_name, hashrate, shares, last_seen, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`;

    const now = Date.now();
    
    // Check if this address+worker combination already exists
    const existing = await this.get(
      'SELECT created_at FROM miners WHERE address = ? AND worker_name = ?', 
      [miner.address, miner.worker_name]
    );
    
    const created = existing ? existing.created_at : (miner.created_at || now);

    logger.info(`Adding miner: ${workerId} (provided ID was: ${miner.id})`);
    
    return this.run(sql, [
      workerId,  // Use consistent composite key ALWAYS
      miner.address,
      miner.worker_name,
      miner.hashrate || 0,
      miner.shares || 0,
      miner.last_seen || now,
      created,
    ]);
  }

  async updateMiner(miner) {
    const sql = `UPDATE miners
                     SET hashrate = ?, shares = ?, last_seen = ?
                     WHERE id = ?`;

    return this.run(sql, [miner.hashrate, miner.shares, Date.now(), miner.id]);
  }

  async getMiner(id) {
    return this.get('SELECT * FROM miners WHERE id = ?', [id]);
  }

  async getAllMiners() {
    return this.all('SELECT * FROM miners ORDER BY last_seen DESC');
  }

  async getMiners() {
    return this.all('SELECT * FROM miners ORDER BY last_seen DESC');
  }

  async clearMiners() {
    logger.info('Clearing all miners from database (startup cleanup)');
    return this.run('DELETE FROM miners');
  }

  // Remove offline miners (not seen for more than X minutes)
  async removeOfflineMiners(offlineMinutes = 10) {
    const cutoffTime = Date.now() - (offlineMinutes * 60 * 1000);
    const result = await this.run('DELETE FROM miners WHERE last_seen < ?', [cutoffTime]);
    const deletedCount = result.changes || 0;
    if (deletedCount > 0) {
      logger.info(`Removed ${deletedCount} offline miners (not seen for ${offlineMinutes}+ minutes)`);
    }
    return deletedCount;
  }

  async cleanupDuplicateWorkers() {
    // Remove duplicate workers, keeping only the most recent one for each address+worker_name combination
    const sql = `
      DELETE FROM miners 
      WHERE rowid NOT IN (
        SELECT MAX(rowid) 
        FROM miners 
        GROUP BY address, worker_name
      )
    `;
    const result = await this.run(sql);
    const cleanedCount = result.changes || 0;
    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} duplicate worker entries`);
    }
    return cleanedCount;
  }

  // Get miners grouped by address to handle duplicates
  async getMinersGroupedByAddress() {
    const sql = `
      SELECT 
        address,
        COUNT(*) as worker_count,
        SUM(hashrate) as total_hashrate,
        SUM(shares) as total_shares,
        MAX(last_seen) as last_seen,
        MIN(created_at) as first_seen,
        GROUP_CONCAT(worker_name) as worker_names,
        GROUP_CONCAT(id) as worker_ids
      FROM miners 
      GROUP BY address
      ORDER BY total_hashrate DESC
    `;
    return this.all(sql);
  }

  // Share management
  async addShare(share) {
    const sql = `INSERT INTO shares
                     (miner_id, worker_name, job_id, extra_nonce2, n_time, nonce, difficulty, is_valid, is_block, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    return this.run(sql, [
      share.miner_id,
      share.worker_name,
      share.job_id,
      share.extra_nonce2,
      share.n_time,
      share.nonce,
      share.difficulty,
      share.is_valid ? 1 : 0,
      share.is_block ? 1 : 0,
      Date.now(),
    ]);
  }

  async getShares(limit = 100, offset = 0) {
    const sql = `SELECT * FROM shares
                     ORDER BY timestamp DESC
                     LIMIT ? OFFSET ?`;

    return this.all(sql, [limit, offset]);
  }

  async getMinerShares(minerId, limit = 100) {
    const sql = `SELECT * FROM shares
                     WHERE miner_id = ?
                     ORDER BY timestamp DESC
                     LIMIT ?`;

    return this.all(sql, [minerId, limit]);
  }

  async getMinerShareStats(minerId) {
    const sql = `SELECT
      COUNT(*) as total_shares,
      SUM(CASE WHEN is_valid = 1 THEN 1 ELSE 0 END) as valid_shares,
      SUM(CASE WHEN is_valid = 0 THEN 1 ELSE 0 END) as rejected_shares,
      SUM(CASE WHEN is_block = 1 THEN 1 ELSE 0 END) as blocks_found
      FROM shares WHERE miner_id = ?`;

    return this.get(sql, [minerId]);
  }

  async getTotalShareStats() {
    const sql = `SELECT
      COUNT(*) as total_shares,
      SUM(CASE WHEN is_valid = 1 THEN 1 ELSE 0 END) as valid_shares,
      SUM(CASE WHEN is_valid = 0 THEN 1 ELSE 0 END) as rejected_shares,
      SUM(CASE WHEN is_block = 1 THEN 1 ELSE 0 END) as blocks_found
      FROM shares`;

    return this.get(sql);
  }

  async getMiner(minerId) {
    return this.get('SELECT * FROM miners WHERE id = ?', [minerId]);
  }

  // Block management
  async addBlock(block) {
    try {
      // First check if a block at this height already exists
      const existingBlock = await this.get('SELECT * FROM blocks WHERE height = ?', [block.height]);

      if (existingBlock) {
        // Block at this height already exists - check if this is a better solution
        const existingHash = BigInt('0x' + existingBlock.hash);
        const newHash = BigInt('0x' + block.hash);

        if (newHash < existingHash) {
          // New block has lower hash (better solution) - update it
          logger.info(`Updating block at height ${block.height} with better solution: ${block.hash.substring(0, 16)}... (was: ${existingBlock.hash.substring(0, 16)}...)`);

          const updateSql = `UPDATE blocks SET
            hash = ?,
            previous_hash = ?,
            merkle_root = ?,
            timestamp = ?,
            nonce = ?,
            difficulty = ?,
            found_by = ?,
            created_at = ?
            WHERE height = ?`;

          return this.run(updateSql, [
            block.hash,
            block.previous_hash,
            block.merkle_root,
            block.timestamp,
            block.nonce,
            block.difficulty,
            block.found_by,
            Date.now(),
            block.height
          ]);
        } else {
          // Existing block is better or equal - log and return success
          logger.info(`Block at height ${block.height} already exists with better/equal solution: ${existingBlock.hash.substring(0, 16)}... (new: ${block.hash.substring(0, 16)}...)`);
          return { id: existingBlock.id, changes: 0 };
        }
      } else {
        // No existing block at this height - insert new one
        const sql = `INSERT INTO blocks
                       (height, hash, previous_hash, merkle_root, timestamp, nonce, difficulty, found_by, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        return this.run(sql, [
          block.height,
          block.hash,
          block.previous_hash,
          block.merkle_root,
          block.timestamp,
          block.nonce,
          block.difficulty,
          block.found_by,
          Date.now(),
        ]);
      }
    } catch (error) {
      logger.error(`Error in addBlock: ${error.message}`);
      throw error;
    }
  }

  async updateBlockStatus(height, status) {
    const sql = `UPDATE blocks SET status = ? WHERE height = ?`;
    return this.run(sql, [status, height]);
  }

  async getBlocks(limit = 50) {
    const sql = `SELECT * FROM blocks
                     ORDER BY height DESC
                     LIMIT ?`;

    return this.all(sql, [limit]);
  }

  async getBlockByHeight(height) {
    return this.get('SELECT * FROM blocks WHERE height = ?', [height]);
  }

  async getBlocksCount() {
    const result = await this.get('SELECT COUNT(*) as count FROM blocks');
    return result ? result.count : 0;
  }

  // Pool statistics
  async updatePoolStats(stats) {
    const sql = `INSERT INTO pool_stats
                     (total_hashrate, active_miners, total_shares, valid_shares, invalid_shares, blocks_found, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`;

    return this.run(sql, [
      stats.total_hashrate,
      stats.active_miners,
      stats.total_shares,
      stats.valid_shares,
      stats.invalid_shares,
      stats.blocks_found,
      Date.now(),
    ]);
  }

  async getPoolStats(limit = 100) {
    const sql = `SELECT * FROM pool_stats
                     ORDER BY timestamp DESC
                     LIMIT ?`;

    return this.all(sql, [limit]);
  }

  async getLatestPoolStats() {
    return this.get('SELECT * FROM pool_stats ORDER BY timestamp DESC LIMIT 1');
  }

  async updateMinerHashrate(minerId, hashrate) {
    const sql = `UPDATE miners SET hashrate = ?, last_seen = ? WHERE id = ?`;
    return this.run(sql, [hashrate, Date.now(), minerId]);
  }

  async updateMinerShares(minerId, totalShares, validShares, rejectedShares, blocksFound) {
    const sql = `UPDATE miners SET shares = ?, last_seen = ? WHERE id = ?`;
    return this.run(sql, [totalShares, Date.now(), minerId]);
  }


  // Cleanup old data
  async cleanupOldData(days = 30) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    await this.run('DELETE FROM shares WHERE timestamp < ?', [cutoff]);
    await this.run('DELETE FROM pool_stats WHERE timestamp < ?', [cutoff]);

    // Keep miners but update last_seen if they haven't been seen recently
    await this.run('UPDATE miners SET last_seen = 0 WHERE last_seen < ?', [cutoff]);
  }

  // Leaderboard management
  async updateLeaderboard(address, stats) {
    const sql = `INSERT OR REPLACE INTO leaderboard
                 (address, worker_count, total_hashrate, avg_hashrate_1h, avg_hashrate_3h, avg_hashrate_24h,
                  total_shares, valid_shares, rejected_shares, blocks_found, 
                  confirmed_balance, unconfirmed_balance, total_paid, last_active, first_seen, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const existing = await this.get('SELECT first_seen FROM leaderboard WHERE address = ?', [address]);
    const firstSeen = existing ? existing.first_seen : Date.now();

    return this.run(sql, [
      address,
      stats.worker_count || 0,
      stats.total_hashrate || 0,
      stats.avg_hashrate_1h || 0,
      stats.avg_hashrate_3h || 0,
      stats.avg_hashrate_24h || 0,
      stats.total_shares || 0,
      stats.valid_shares || 0,
      stats.rejected_shares || 0,
      stats.blocks_found || 0,
      stats.confirmed_balance || 0,
      stats.unconfirmed_balance || 0,
      stats.total_paid || 0,
      stats.last_active || Date.now(),
      firstSeen,
      Date.now()
    ]);
  }

  async addMinerToLeaderboard(address, stats) {
    const sql = `INSERT OR REPLACE INTO leaderboard
                 (address, worker_count, total_hashrate, avg_hashrate_1h, avg_hashrate_3h, avg_hashrate_24h,
                  total_shares, valid_shares, rejected_shares, blocks_found, 
                  confirmed_balance, unconfirmed_balance, total_paid, last_active, first_seen, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const now = Date.now();
    return this.run(sql, [
      address,
      stats.worker_count || 0,
      stats.total_hashrate || 0,
      stats.avg_hashrate_1h || 0,
      stats.avg_hashrate_3h || 0,
      stats.avg_hashrate_24h || 0,
      stats.total_shares || 0,
      stats.valid_shares || 0,
      stats.rejected_shares || 0,
      stats.blocks_found || 0,
      stats.confirmed_balance || 0,
      stats.unconfirmed_balance || 0,
      stats.total_paid || 0,
      stats.last_active || now,
      stats.first_seen || now,
      now
    ]);
  }

  async getLeaderboard(limit = 50) {
    const sql = `SELECT * FROM leaderboard 
                 ORDER BY total_hashrate DESC, total_shares DESC 
                 LIMIT ?`;
    return this.all(sql, [limit]);
  }

  async getMinerFromLeaderboard(address) {
    return this.get('SELECT * FROM leaderboard WHERE address = ?', [address]);
  }

  // Miner stats history for persistent display
  async addMinerStatsHistory(address, stats) {
    const sql = `INSERT INTO miner_stats_history
                 (address, hashrate, shares_submitted, shares_accepted, shares_rejected, workers_online, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;

    return this.run(sql, [
      address,
      stats.hashrate || 0,
      stats.shares_submitted || 0,
      stats.shares_accepted || 0,
      stats.shares_rejected || 0,
      stats.workers_online || 0,
      Date.now()
    ]);
  }

  async getMinerStatsHistory(address, hours = 24) {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const sql = `SELECT * FROM miner_stats_history 
                 WHERE address = ? AND timestamp >= ? 
                 ORDER BY timestamp DESC`;
    return this.all(sql, [address, cutoff]);
  }

  async getLatestMinerStats(address) {
    const sql = `SELECT * FROM miner_stats_history 
                 WHERE address = ? 
                 ORDER BY timestamp DESC 
                 LIMIT 1`;
    return this.get(sql, [address]);
  }

  // Calculate average hashrates for leaderboard
  async calculateMinerAverageHashrates(address) {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const threeHours = 3 * oneHour;
    const twentyFourHours = 24 * oneHour;

    const [avg1h, avg3h, avg24h] = await Promise.all([
      this.get(`SELECT AVG(hashrate) as avg_hashrate FROM miner_stats_history 
                WHERE address = ? AND timestamp >= ?`, [address, now - oneHour]),
      this.get(`SELECT AVG(hashrate) as avg_hashrate FROM miner_stats_history 
                WHERE address = ? AND timestamp >= ?`, [address, now - threeHours]),
      this.get(`SELECT AVG(hashrate) as avg_hashrate FROM miner_stats_history 
                WHERE address = ? AND timestamp >= ?`, [address, now - twentyFourHours])
    ]);

    return {
      avg_hashrate_1h: avg1h?.avg_hashrate || 0,
      avg_hashrate_3h: avg3h?.avg_hashrate || 0,
      avg_hashrate_24h: avg24h?.avg_hashrate || 0
    };
  }

  // Balance calculation methods
  async updateMinerBalance(address, validShares, totalPoolShares, blockReward = 50.0, poolFeePercent = 1.0) {
    if (totalPoolShares === 0) return;

    // Convert block reward to atomic units to avoid floating point errors
    const blockRewardAtomic = toAtomicUnits(blockReward);
    const poolFeeAtomic = Math.floor(blockRewardAtomic * (poolFeePercent / 100));
    const netRewardAtomic = blockRewardAtomic - poolFeeAtomic;
    
    // Calculate miner's share in atomic units
    const minerContribution = validShares / totalPoolShares;
    const minerRewardAtomic = Math.floor(netRewardAtomic * minerContribution);

    // Add to unconfirmed balance - ensure the leaderboard record exists first
    const existingRecord = await this.get(
      'SELECT address FROM leaderboard WHERE address = ?', 
      [address]
    );

    if (!existingRecord) {
      // Create leaderboard record if it doesn't exist
      await this.addMinerToLeaderboard(address, {
        worker_count: 1,
        total_hashrate: 0,
        confirmed_balance: 0,
        unconfirmed_balance: minerRewardAtomic,
        total_paid: 0,
        total_shares: validShares,
        valid_shares: validShares,
        rejected_shares: 0,
        blocks_found: 0
      });
    } else {
      // Update existing record - add atomic units to balance
      const sql = `UPDATE leaderboard 
                   SET unconfirmed_balance = unconfirmed_balance + ? 
                   WHERE address = ?`;
      
      await this.run(sql, [minerRewardAtomic, address]);
    }
    
    return minerRewardAtomic;
  }

  async confirmBalance(address, amount) {
    // Move from unconfirmed to confirmed balance
    const sql = `UPDATE leaderboard 
                 SET confirmed_balance = confirmed_balance + ?,
                     unconfirmed_balance = unconfirmed_balance - ?
                 WHERE address = ?`;
    
    return this.run(sql, [amount, amount, address]);
  }

  async processPayment(address, amount) {
    // Deduct from confirmed balance and add to total paid
    const sql = `UPDATE leaderboard 
                 SET confirmed_balance = confirmed_balance - ?,
                     total_paid = total_paid + ?
                 WHERE address = ?`;
    
    return this.run(sql, [amount, amount, address]);
  }

  async getMinerBalance(address) {
    // Get balances in atomic units
    const confirmedBalanceAtomic = await this.calculateConfirmedBalance(address);
    const unconfirmedBalanceAtomic = await this.calculateUnconfirmedBalance(address);

    // Get total paid from leaderboard if exists (already in atomic units)
    const leaderboardData = await this.get(
      `SELECT total_paid FROM leaderboard WHERE address = ?`,
      [address]
    );
    const totalPaidAtomic = leaderboardData ? leaderboardData.total_paid : 0;

    return {
      confirmed_balance: confirmedBalanceAtomic,
      unconfirmed_balance: unconfirmedBalanceAtomic,
      total_paid: totalPaidAtomic
    };
  }

  async getTotalPoolShares(timeWindow = 3600000) { // Default 1 hour
    const cutoff = Date.now() - timeWindow;
    const result = await this.get(
      `SELECT COUNT(*) as total_shares FROM shares WHERE timestamp >= ? AND is_valid = 1`,
      [cutoff]
    );
    return result ? result.total_shares : 0;
  }

  async getMinerShares(address, timeWindow = 3600000) { // Default 1 hour
    const cutoff = Date.now() - timeWindow;
    const result = await this.get(
      `SELECT COUNT(*) as miner_shares FROM shares 
       WHERE miner_id = ? AND timestamp >= ? AND is_valid = 1`,
      [address, cutoff]
    );
    return result ? result.miner_shares : 0;
  }

  async getMinersWithShares(timeWindow = 3600000) { // Default 1 hour
    const cutoff = Date.now() - timeWindow;
    const results = await this.all(
      `SELECT m.address as miner_id, COUNT(*) as share_count 
       FROM shares s
       JOIN miners m ON s.miner_id = m.id
       WHERE s.timestamp >= ? AND s.is_valid = 1 
       GROUP BY m.address`,
      [cutoff]
    );
    return results || [];
  }

  // Per-block rewards management
  async addBlockReward(blockReward) {
    const sql = `INSERT OR REPLACE INTO block_rewards
                 (block_height, block_hash, miner_address, base_reward, pool_fee, miner_reward,
                  pool_hashrate, miner_hashrate, miner_percentage, timestamp, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    return this.run(sql, [
      blockReward.block_height,
      blockReward.block_hash,
      blockReward.miner_address,
      blockReward.base_reward,
      blockReward.pool_fee,
      blockReward.miner_reward,
      blockReward.pool_hashrate,
      blockReward.miner_hashrate,
      blockReward.miner_percentage,
      blockReward.timestamp || Date.now(),
      Date.now()
    ]);
  }

  async getBlockRewards(limit = 50) {
    const sql = `SELECT br.*, b.status as block_status
                 FROM block_rewards br
                 LEFT JOIN blocks b ON br.block_height = b.height
                 ORDER BY br.block_height DESC
                 LIMIT ?`;

    return this.all(sql, [limit]);
  }

  async getMinerBlockRewards(address, limit = 50) {
    const sql = `SELECT br.*, b.status as block_status
                 FROM block_rewards br
                 LEFT JOIN blocks b ON br.block_height = b.height
                 WHERE br.miner_address = ?
                 ORDER BY br.block_height DESC
                 LIMIT ?`;

    return this.all(sql, [address, limit]);
  }

  async getBlockRewardByHeight(height) {
    const sql = `SELECT br.*, b.status as block_status
                 FROM block_rewards br
                 LEFT JOIN blocks b ON br.block_height = b.height
                 WHERE br.block_height = ?`;

    return this.all(sql, [height]);
  }

  /**
   * Calculate confirmed balance for a miner
   * Confirmed balance comes from blocks with 'confirmed' status
   */
  async calculateConfirmedBalance(address) {
    try {
      // Get total confirmed rewards from block_rewards table that haven't been paid out
      const { toAtomicUnits } = require('../utils/atomicUnits.js');
      const result = await this.get(
        `SELECT SUM(br.miner_reward) as total_confirmed_reward
         FROM block_rewards br
         JOIN blocks b ON br.block_height = b.height
         WHERE br.miner_address = ? AND b.status = 'confirmed' AND br.paid_out = 0`,
        [address]
      );

      const rewardPAS = result?.total_confirmed_reward || 0;
      return toAtomicUnits(rewardPAS); // Return atomic units
    } catch (error) {
      console.error(`Error calculating confirmed balance for ${address}: ${error.message}`);
      return 0;
    }
  }
  
  /**
   * Calculate unconfirmed balance for a miner
   * Unconfirmed balance comes from recently found blocks pending confirmation
   */
  async calculateUnconfirmedBalance(address) {
    try {
      // Get total unconfirmed rewards from block_rewards table
      // Include pending, found, and confirming statuses for unconfirmed balance
      const { toAtomicUnits } = require('../utils/atomicUnits.js');
      const result = await this.get(
        `SELECT SUM(br.miner_reward) as total_unconfirmed_reward
         FROM block_rewards br
         JOIN blocks b ON br.block_height = b.height
         WHERE br.miner_address = ? AND b.status IN ('pending', 'found', 'confirming')`,
        [address]
      );

      const rewardPAS = result?.total_unconfirmed_reward || 0;
      return toAtomicUnits(rewardPAS); // Return atomic units
    } catch (error) {
      console.error(`Error calculating unconfirmed balance for ${address}: ${error.message}`);
      return 0;
    }
  }

  // Payment related methods
  async getMinersForPayment(minPayoutAtomic) {
    // Get all miners from leaderboard and calculate their real confirmed balance dynamically
    const allMiners = await this.all(`SELECT address FROM leaderboard`);
    const eligibleMiners = [];

    for (const miner of allMiners) {
      const confirmedBalanceAtomic = await this.calculateConfirmedBalance(miner.address);
      if (confirmedBalanceAtomic >= minPayoutAtomic) {
        eligibleMiners.push({
          address: miner.address,
          confirmed_balance: confirmedBalanceAtomic
        });
      }
    }

    // Sort by confirmed balance descending
    return eligibleMiners.sort((a, b) => b.confirmed_balance - a.confirmed_balance);
  }

  async recordPayment(batchId, transactionId, minerAddress, amountAtomic, feeAtomic, netAmountAtomic) {
    await this.run(
      `INSERT INTO payments (batch_id, transaction_id, miner_address, amount_atomic, fee_atomic, net_amount_atomic, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [batchId, transactionId, minerAddress, amountAtomic, feeAtomic, netAmountAtomic, Date.now()]
    );
  }

  async updatePaymentStatus(transactionId, status, errorMessage = null) {
    await this.run(
      `UPDATE payments SET status = ?, error_message = ?, confirmed_at = ? WHERE transaction_id = ?`,
      [status, errorMessage, status === 'confirmed' ? Date.now() : null, transactionId]
    );
  }

  async updateMinerBalanceAfterPayment(minerAddress, paidAmountAtomic) {
    // Mark confirmed block rewards as paid out and update total_paid in leaderboard
    const { fromAtomicUnits } = require('../utils/atomicUnits.js');
    const paidAmountPAS = fromAtomicUnits(paidAmountAtomic);

    // Get unpaid confirmed block rewards for this miner, ordered by block height
    const unpaidRewards = await this.all(
      `SELECT br.id, br.miner_reward
       FROM block_rewards br
       JOIN blocks b ON br.block_height = b.height
       WHERE br.miner_address = ? AND b.status = 'confirmed' AND br.paid_out = 0
       ORDER BY br.block_height ASC`,
      [minerAddress]
    );

    // Mark rewards as paid out until we reach the paid amount
    let remainingToPay = paidAmountPAS;
    for (const reward of unpaidRewards) {
      if (remainingToPay <= 0) break;

      if (reward.miner_reward <= remainingToPay) {
        // Mark this reward as paid out
        await this.run(
          `UPDATE block_rewards SET paid_out = 1 WHERE id = ?`,
          [reward.id]
        );
        remainingToPay -= reward.miner_reward;
      } else {
        // This shouldn't happen if payment amounts are calculated correctly
        break;
      }
    }

    // Update total_paid in leaderboard (both should be in atomic units now)
    await this.run(
      `UPDATE leaderboard
       SET total_paid = total_paid + ?,
           updated_at = ?
       WHERE address = ?`,
      [paidAmountAtomic, Date.now(), minerAddress]
    );
  }

  async getPaymentHistory(minerAddress = null, limit = 50, offset = 0) {
    if (minerAddress) {
      return this.all(
        `SELECT * FROM payments WHERE miner_address = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [minerAddress, limit, offset]
      );
    } else {
      return this.all(
        `SELECT * FROM payments ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    }
  }

  async getPaymentStats() {
    const stats = await this.get(`
      SELECT
        COUNT(*) as total_payments,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_payments,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_payments,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_payments,
        SUM(CASE WHEN status = 'confirmed' THEN amount_atomic ELSE 0 END) as total_paid_atomic,
        SUM(CASE WHEN status = 'confirmed' THEN fee_atomic ELSE 0 END) as total_fees_atomic
      FROM payments
    `);

    return {
      ...stats,
      total_paid_atomic: stats.total_paid_atomic || 0,
      total_fees_atomic: stats.total_fees_atomic || 0
    };
  }

  // Transaction validation methods
  async getPendingPayments() {
    return this.all(
      `SELECT * FROM payments WHERE status IN ('pending', 'submitted', 'confirming') ORDER BY created_at DESC`
    );
  }

  async updatePaymentConfirmations(transactionId, confirmations) {
    await this.run(
      `UPDATE payments SET confirmations = ? WHERE transaction_id = ?`,
      [confirmations, transactionId]
    );
  }

  async restoreFailedPaymentBalance(minerAddress, amountAtomic, transactionId) {
    // This creates a credit entry by not marking block rewards as paid out
    // The failed payment amount should be restored to the miner's available balance

    // Find the payment record to understand what rewards were affected
    const payment = await this.get(
      `SELECT * FROM payments WHERE transaction_id = ? AND miner_address = ?`,
      [transactionId, minerAddress]
    );

    if (payment) {
      // Restore the block rewards that were marked as paid out for this transaction
      // by unmarking them as paid (set paid_out back to 0)
      await this.run(
        `UPDATE block_rewards
         SET paid_out = 0
         WHERE miner_address = ?
         AND paid_out = 1
         AND id IN (
           SELECT br.id FROM block_rewards br
           JOIN blocks b ON br.block_height = b.height
           WHERE br.miner_address = ? AND b.status = 'confirmed' AND br.paid_out = 1
           ORDER BY b.height ASC
           LIMIT (SELECT COUNT(*) FROM block_rewards br2
                  JOIN blocks b2 ON br2.block_height = b2.height
                  WHERE br2.miner_address = ? AND b2.status = 'confirmed' AND br2.paid_out = 1)
         )`,
        [minerAddress, minerAddress, minerAddress]
      );

      logger.info(`Restored failed payment balance for ${minerAddress}: ${fromAtomicUnits(amountAtomic)} PAS`);
    }
  }

  async close() {
    return new Promise(resolve => {
      if (this.db) {
        this.db.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

module.exports = DatabaseManager;

