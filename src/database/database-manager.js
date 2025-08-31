const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('../utils/logger.js');

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
    ];

    for (const table of tables) {
      await this.run(table);
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
    const sql = `INSERT OR REPLACE INTO miners
                     (id, address, worker_name, hashrate, shares, last_seen, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`;

    const now = Date.now();
    const created = miner.created_at || now;

    return this.run(sql, [
      miner.id,
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

  async addShare(shareData) {
    const sql = `INSERT INTO shares
                   (miner_id, worker_name, job_id, extra_nonce2, n_time, nonce, difficulty, is_valid, is_block, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    return this.run(sql, [
      shareData.miner_id,
      shareData.worker_name,
      shareData.job_id,
      shareData.extra_nonce2,
      shareData.n_time,
      shareData.nonce,
      shareData.difficulty,
      shareData.is_valid ? 1 : 0,
      shareData.is_block ? 1 : 0,
      shareData.timestamp
    ]);
  }

  // Cleanup old data
  async cleanupOldData(days = 30) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    await this.run('DELETE FROM shares WHERE timestamp < ?', [cutoff]);
    await this.run('DELETE FROM pool_stats WHERE timestamp < ?', [cutoff]);

    // Keep miners but update last_seen if they haven't been seen recently
    await this.run('UPDATE miners SET last_seen = 0 WHERE last_seen < ?', [cutoff]);
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

