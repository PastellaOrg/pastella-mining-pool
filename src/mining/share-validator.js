const VeloraUtils = require('../utils/velora.js');
const logger = require('../utils/logger.js');
const axios = require('axios');

class ShareValidator {
  constructor(config, blockTemplateManager) {
    this.config = config;
    this.blockTemplateManager = blockTemplateManager;
    this.veloraUtils = new VeloraUtils();

    // Share validation settings
    this.shareTimeout = this.config.get('mining.shareTimeout') || 300000; // 5 minutes
    this.maxShareAge = this.config.get('mining.maxShareAge') || 3600000; // 1 hour

    // Statistics
    this.stats = {
      totalShares: 0,
      validShares: 0,
      invalidShares: 0,
      staleShares: 0,
      blocksFound: 0,
      lastBlockFound: null,
      blocksSubmitted: 0,
      blocksAccepted: 0,
      blocksRejected: 0,
    };

    // Track which heights are being processed to prevent duplicate submissions
    this.processingHeights = new Set();

    // Database manager (set by pool.js)
    this.databaseManager = null;
  }

  /**
   * Set database manager
   */
  setDatabaseManager(databaseManager) {
    this.databaseManager = databaseManager;
  }

  /**
   * Store share in database
   */
  async storeShareInDatabase(shareData, minerAddress, isValid, isBlock) {
    if (!this.databaseManager) {
      return;
    }

    try {
      // Find miner ID by address
      const miners = await this.databaseManager.getMiners();
      const miner = miners.find(m => m.address === minerAddress);

      if (!miner) {
        logger.warn(`Miner not found in database for address: ${minerAddress}`);
        return;
      }

      const dbShareData = {
        miner_id: miner.id,
        worker_name: shareData.workerName || 'unknown',
        job_id: shareData.jobId,
        extra_nonce2: shareData.extraNonce2 || '00000000',
        n_time: shareData.nTime || shareData.timestamp.toString(),
        nonce: shareData.nonce,
        difficulty: shareData.difficulty || 1,
        is_valid: isValid,
        is_block: isBlock,
        timestamp: Date.now()
      };

      await this.databaseManager.addShare(dbShareData);
      logger.debug(`Share stored in database for miner ${minerAddress}, valid: ${isValid}, block: ${isBlock}`);

      // Update miner share statistics
      await this.updateMinerShareStats(miner.id);
    } catch (error) {
      logger.error(`Error storing share in database: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Update miner share statistics in database
   */
  async updateMinerShareStats(minerId) {
    if (!this.databaseManager) {
      return;
    }

    try {
      // Get current share statistics for this miner
      const shareStats = await this.databaseManager.getMinerShareStats(minerId);

      // Update miner's share count
      await this.databaseManager.updateMinerShares(
        minerId,
        shareStats.total_shares || 0,
        shareStats.valid_shares || 0,
        shareStats.rejected_shares || 0,
        shareStats.blocks_found || 0
      );
    } catch (error) {
      logger.error(`Error updating miner share stats: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Validate a mining share
   */
  validateShare(shareData, minerAddress) {
    try {
      // Basic validation
      if (!this.validateShareStructure(shareData)) {
        return { valid: false, reason: 'Invalid share structure' };
      }

      // Check if share is too old
      if (this.isShareStale(shareData.timestamp)) {
        this.stats.staleShares++;
        return { valid: false, reason: 'Share is too old' };
      }

      // Get current block template
      const template = this.blockTemplateManager.getCurrentTemplate();
      if (!template) {
        return { valid: false, reason: 'No block template available' };
      }

      // Validate share against template
      const validationResult = this.validateShareWithVelora(shareData, template, minerAddress);

      if (validationResult.valid) {
        this.stats.validShares++;

        // Check if this is a block solution
        if (validationResult.isBlockSolution) {
          // Check if we're already processing a block for this height
          const blockHeight = template.index;
          if (this.processingHeights.has(blockHeight)) {
            logger.warn(`⚠️ Block solution for height ${blockHeight} already being processed, skipping duplicate submission`);
            // Still count it as a block found but don't submit again
            this.stats.blocksFound++;
            return validationResult;
          }

          // Add this height to processing set
          this.processingHeights.add(blockHeight);
          logger.debug(`Added height ${blockHeight} to processing set`);

          this.stats.blocksFound++;
          this.stats.lastBlockFound = Date.now();
          logger.info(`🎉 Block found by ${minerAddress}! Hash: ${shareData.hash}`);

          // CRITICAL: Submit the block to the daemon and await result
          validationResult.blockSubmissionPromise = this.submitBlockToDaemon(shareData, template, minerAddress)
            .then((result) => {
              if (result && result.success) {
                logger.info(`✅ Block ${blockHeight} successfully accepted by daemon`);
              } else {
                logger.warn(`❌ Block ${blockHeight} rejected by daemon: ${result?.error || 'Unknown error'}`);
              }
              return result;
            })
            .catch((error) => {
              logger.error(`❌ Block ${blockHeight} submission error: ${error.message}`);
              return { success: false, error: error.message };
            })
            .finally(() => {
              // Remove height from processing set when submission is complete
              this.processingHeights.delete(blockHeight);
              logger.debug(`Removed height ${blockHeight} from processing set`);
            });
        }

        // Store valid share in database (fire and forget)
        this.storeShareInDatabase(shareData, minerAddress, true, validationResult.isBlockSolution).catch(error => {
          logger.error(`Failed to store valid share in database: ${error.message}`);
        });
      } else {
        this.stats.invalidShares++;

        // Store invalid share in database (fire and forget)
        this.storeShareInDatabase(shareData, minerAddress, false, false).catch(error => {
          logger.error(`Failed to store invalid share in database: ${error.message}`);
        });
      }

      this.stats.totalShares++;
      return validationResult;
    } catch (error) {
      logger.error(`Share validation error: ${error.message}`);
      this.stats.invalidShares++;
      return { valid: false, reason: 'Validation error', error: error.message };
    }
  }

  /**
   * Validate share structure
   */
  validateShareStructure(shareData) {
    const required = ['jobId', 'nonce', 'timestamp', 'hash', 'difficulty'];

    logger.debug(`Validating share structure. Share data: ${JSON.stringify(shareData)}`);

    for (const field of required) {
      if (!shareData.hasOwnProperty(field)) {
        logger.warn(`Share missing required field: ${field}`);
        return false;
      }
    }

    // Validate data types
    if (typeof shareData.nonce !== 'string' || shareData.nonce.length !== 8) {
      // xmrig sends 8-char nonce, not 16
      logger.warn(`Invalid nonce format: ${shareData.nonce} (expected 8 hex chars, got ${shareData.nonce.length})`);
      return false;
    }

    if (typeof shareData.hash !== 'string' || shareData.hash.length !== 64) {
      logger.warn(`Invalid hash format: ${shareData.hash} (expected 64 hex chars, got ${shareData.hash.length})`);
      return false;
    }

    if (typeof shareData.difficulty !== 'number' || shareData.difficulty <= 0) {
      logger.warn(`Invalid difficulty: ${shareData.difficulty}`);
      return false;
    }

    return true;
  }

  /**
   * Check if share is stale
   */
  isShareStale(timestamp) {
    // Convert Unix timestamp (seconds) to milliseconds for comparison with Date.now()
    const timestampMs = timestamp * 1000;
    const age = Date.now() - timestampMs;
    return age > this.shareTimeout;
  }

  /**
   * Validate share using Velora algorithm
   */
  validateShareWithVelora(shareData, template, minerAddress) {
    try {
      // Parse nonce from hex string
      const nonce = parseInt(shareData.nonce, 16);
      if (isNaN(nonce)) {
        return { valid: false, reason: 'Invalid nonce format' };
      }

      // Trust the hash calculated by xmrig (it has already done the proof-of-work)
      // In a production environment, you might want to spot-check hashes occasionally
      logger.debug(`Accepting hash from miner: ${shareData.hash}`);

      // Check if hash meets pool difficulty requirements (not network difficulty)
      const hashValue = BigInt('0x' + shareData.hash);
      const shareTarget = BigInt(2) ** BigInt(256) / BigInt(shareData.difficulty); // Use pool difficulty

      // DEBUG: Add detailed logging
      logger.debug(`Share validation debug:`);
      logger.debug(`  Hash: ${shareData.hash}`);
      logger.debug(`  Pool Difficulty: ${shareData.difficulty}`);
      logger.debug(`  Hash Value: ${hashValue.toString()}`);
      logger.debug(`  Share Target: ${shareTarget.toString()}`);
      logger.debug(`  Hash <= Target: ${hashValue <= shareTarget}`);

      if (hashValue > shareTarget) {
        logger.warn(`Share rejected: hash ${shareData.hash.substring(0, 16)}... does not meet pool difficulty ${shareData.difficulty}`);
        logger.warn(`  Hash Value: ${hashValue.toString()}`);
        logger.warn(`  Share Target: ${shareTarget.toString()}`);
        return { valid: false, reason: 'Hash does not meet pool difficulty requirement' };
      }

      logger.info(`✅ Share accepted from ${minerAddress} - meets pool difficulty ${shareData.difficulty}`);

      // Check if this is a block solution (meets block difficulty)
      const blockTarget = BigInt(2) ** BigInt(256) / BigInt(template.difficulty);
      const isBlockSolution = hashValue <= blockTarget;

      // Calculate share difficulty (how much better than required)
      const shareDifficulty = this.calculateShareDifficulty(hashValue, template.difficulty);

      return {
        valid: true,
        isBlockSolution: isBlockSolution,
        shareDifficulty: shareDifficulty,
        hash: shareData.hash,
        nonce: shareData.nonce,
        timestamp: shareData.timestamp,
        minerAddress: minerAddress,
        templateIndex: template.index,
        blockDifficulty: template.difficulty,
        poolDifficulty: shareData.difficulty, // This is what the miner actually used
      };
    } catch (error) {
      logger.error(`Velora validation error: ${error.message}`);
      return { valid: false, reason: 'Algorithm validation error', error: error.message };
    }
  }

  /**
   * Calculate share difficulty based on hash value
   */
  calculateShareDifficulty(hashValue, targetDifficulty) {
    try {
      const target = BigInt(2) ** BigInt(256) / BigInt(targetDifficulty);
      const difficulty = Number(target / hashValue);
      return Math.max(1, Math.floor(difficulty));
    } catch (error) {
      logger.warn(`Error calculating share difficulty: ${error.message}`);
      return 1;
    }
  }

  /**
   * Validate a complete block solution
   */
  validateBlockSolution(blockData, minerAddress) {
    try {
      // Debug: Log the block data at the start of validation
      logger.debug(`validateBlockSolution input - Block data keys: ${Object.keys(blockData)}`);
      logger.debug(`validateBlockSolution input - Block data: ${JSON.stringify(blockData, null, 2)}`);
      logger.debug(`validateBlockSolution input - Hash value: ${blockData.hash}`);
      logger.debug(`validateBlockSolution input - Hash type: ${typeof blockData.hash}`);

      const template = this.blockTemplateManager.getCurrentTemplate();
      if (!template) {
        return { valid: false, reason: 'No block template available' };
      }

      // First validate that the hash exists and is properly formatted
      if (!blockData.hash || blockData.hash.length !== 64) {
        logger.error(`Invalid hash format for miner ${minerAddress}: ${blockData.hash}`);
        return { valid: false, reason: 'Invalid hash format' };
      }

      // Now validate the complete block structure (hash should be present now)
      if (!this.validateBlockStructure(blockData)) {
        return { valid: false, reason: 'Invalid block structure' };
      }

      // Use the network difficulty for validation (no longer temporary fix)
      const hashValue = BigInt('0x' + blockData.hash);
      const networkDifficulty = template.difficulty;
      const blockTarget = BigInt(2) ** BigInt(256) / BigInt(networkDifficulty);

      logger.debug(
        `Using network difficulty ${networkDifficulty} for block validation`
      );

      logger.debug(`Block difficulty validation:`);
      logger.debug(`  Hash: ${blockData.hash}`);
      logger.debug(`  Hash Value: ${hashValue.toString(16)}`);
      logger.debug(`  Block Target: ${blockTarget.toString(16)}`);
      logger.debug(`  Network Difficulty: ${networkDifficulty}`);
      logger.debug(`  Hash <= Target? ${hashValue <= blockTarget}`);

      if (hashValue > blockTarget) {
        logger.error(`Hash does not meet BLOCK difficulty requirement for miner ${minerAddress}`);
        logger.error(
          `Hash: ${hashValue.toString(16)}, Block Target: ${blockTarget.toString(16)}, Network Difficulty: ${networkDifficulty}`
        );
        return { valid: false, reason: 'Hash does not meet block difficulty requirement' };
      }

      // Update block difficulty to template difficulty for submission
      blockData.difficulty = template.difficulty;
      logger.debug(`Updated block difficulty to template difficulty: ${template.difficulty}`);

      // Debug: Log timestamp values for troubleshooting
      logger.debug(`Template timestamp: ${template.timestamp} (type: ${typeof template.timestamp})`);
      logger.debug(`Block timestamp: ${blockData.timestamp} (type: ${typeof blockData.timestamp})`);
      logger.debug(`Template timestamp in seconds: ${Math.floor(template.timestamp / 1000)}`);
      logger.debug(`Block timestamp in seconds: ${Math.floor(blockData.timestamp / 1000)}`);

      // Validate timestamp (should be close to template timestamp
      // Both timestamps are now in milliseconds, so we can compare directly
      const timeDiff = Math.abs(blockData.timestamp - template.timestamp);
      if (timeDiff > 300000) { // 5 minutes tolerance in milliseconds
        logger.warn(`Block timestamp too far from template: ${timeDiff}ms (template: ${template.timestamp}ms, block: ${blockData.timestamp}ms)`);
        return { valid: false, reason: 'Block timestamp too old' };
      }

      // Debug: Log the block data at the end of validation to ensure it wasn't modified
      logger.debug(`validateBlockSolution output - Block data keys: ${Object.keys(blockData)}`);
      logger.debug(`validateBlockSolution output - Block data: ${JSON.stringify(blockData, null, 2)}`);

      return {
        valid: true,
        isBlockSolution: true,
        blockHash: blockData.hash,
        blockIndex: blockData.index,
        minerAddress: minerAddress,
        timestamp: blockData.timestamp,
        difficulty: blockData.difficulty,
      };
    } catch (error) {
      logger.error(`Block validation error: ${error.message}`);
      return { valid: false, reason: 'Block validation error', error: error.message };
    }
  }

  /**
   * Submit a block solution to the daemon
   * This is the CRITICAL missing functionality that was causing blocks to never be submitted
   */
  async submitBlockToDaemon(shareData, template, minerAddress) {
    try {
      logger.info(`Submitting block solution to daemon from miner ${minerAddress}`);
      this.stats.blocksSubmitted++;

      // Get daemon configuration
      const daemonConfig = this.config.getDaemonConfig();
      if (!daemonConfig || !daemonConfig.url) {
        throw new Error('Daemon configuration not available');
      }

      // Build the complete block data from the share and template
      const blockData = this.buildBlockFromShare(shareData, template, minerAddress);

      // Debug: Log the block data before validation
      logger.debug(`Block data before validation: ${JSON.stringify(blockData, null, 2)}`);
      logger.debug(`Block data keys: ${Object.keys(blockData)}`);

      // Debug: Check hash before validation
      logger.debug(`Hash before validateBlockSolution: ${blockData.hash}`);
      logger.debug(`Hash type: ${typeof blockData.hash}`);

      // Validate the block before submission (validation may modify blockData)
      const validationResult = this.validateBlockSolution(blockData, minerAddress);
      if (!validationResult.valid) {
        throw new Error(`Block validation failed: ${validationResult.reason}`);
      }

      // Debug: Log the block data after validation
      logger.debug(`Block data after validation: ${JSON.stringify(blockData, null, 2)}`);
      logger.debug(`Block data keys after validation: ${Object.keys(blockData)}`);

      // Prepare request to daemon
      const submitUrl = `${daemonConfig.url}/api/blocks/submit`;
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Pastella-Mining-Pool/1.0.0',
      };

      // Add authentication
      if (daemonConfig.apiKey) {
        headers['X-API-Key'] = daemonConfig.apiKey;
        logger.debug('Using API key authentication for block submission');
      } else if (daemonConfig.username && daemonConfig.password) {
        const auth = Buffer.from(`${daemonConfig.username}:${daemonConfig.password}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
        logger.debug('Using basic authentication for block submission');
      } else {
        logger.warn('No authentication provided for block submission - this may fail');
      }

      // Log the block data being submitted for debugging
      logger.debug(`Submitting block data: ${JSON.stringify(blockData, null, 2)}`);

      // Submit block to daemon
      const response = await axios.post(
        submitUrl,
        {
          block: blockData,
        },
        {
          headers,
          timeout: daemonConfig.timeout || 30000,
        }
      );

      if (response.status === 200 && response.data.success) {
        this.stats.blocksAccepted++;
        logger.info(`Block successfully submitted to daemon! Block ${blockData.index} accepted`);
        logger.info(`Block hash: ${blockData.hash.substring(0, 16)}...`);
        logger.info(`Miner: ${minerAddress}`);

        // Log additional success details
        if (response.data.block) {
          logger.debug(`Daemon confirmed block index: ${response.data.block.index}`);
        }

        // CRITICAL: Return success signal to trigger immediate job invalidation
        return {
          success: true,
          blockIndex: blockData.index,
          hash: blockData.hash,
          invalidateJobs: true
        };
      } else {
        throw new Error(`Daemon returned status ${response.status}: ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      this.stats.blocksRejected++;
      logger.error(`Failed to submit block to daemon: ${error.message}`);

      // Log detailed error information
      if (error.response) {
        logger.error(`Daemon response status: ${error.response.status}`);
        logger.error(`Daemon response data: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        logger.error('No response received from daemon');
      } else {
        logger.error(`Request setup error: ${error.message}`);
      }

      // Log the block data that failed to submit for debugging
      try {
        const blockData = this.buildBlockFromShare(shareData, template, minerAddress);
        logger.error(`Failed block data: ${JSON.stringify(blockData)}`);
      } catch (buildError) {
        logger.error(`Could not build block data for error logging: ${buildError.message}`);
      }
    }
  }

  /**
   * Build complete block data from share and template
   */
  buildBlockFromShare(shareData, template, minerAddress) {
    try {
      // Debug logging to see what we're working with
      logger.debug(`Building block from share data: ${JSON.stringify(shareData)}`);
      logger.debug(`Template data: ${JSON.stringify(template)}`);
      logger.debug(`Share hash field: ${shareData.hash}, Share result field: ${shareData.result}`);

      // CRITICAL FIX: Keep nonce as hex string - don't convert to decimal!
      // XMRig sends nonce as hex string like "c300007b"
      // The daemon must use the exact same nonce format for hash calculation
      let nonce = shareData.nonce;

      // Validate nonce format (should be 8 hex characters)
      if (typeof nonce !== 'string' || nonce.length !== 8 || !/^[0-9a-fA-F]{8}$/.test(nonce)) {
        throw new Error(`Invalid nonce format: ${nonce} (expected 8 hex characters)`);
      }

      // Build the complete block structure - ORDER MATTERS!
      // This must match exactly what the daemon expects
      // CRITICAL: Use template timestamp for daemon submission, not XMRig's timestamp

      // Validate template has required fields
      if (!template.index || !template.timestamp || !template.previousHash || !template.merkleRoot || !template.difficulty) {
        throw new Error(`Template missing required fields: index=${template.index}, timestamp=${template.timestamp}, previousHash=${template.previousHash}, merkleRoot=${template.merkleRoot}, difficulty=${template.difficulty}`);
      }

      const blockData = {
        index: template.index,
        timestamp: template.timestamp, // Use template timestamp (daemon expects this)
        transactions: template.transactions || [],
        previousHash: template.previousHash,
        nonce: parseInt(nonce, 16), // Convert hex nonce to decimal for daemon
        difficulty: template.difficulty,
        hash: null, // Will be calculated after building complete block data
        merkleRoot: template.merkleRoot,
        algorithm: 'velora', // Required field for block validation
      };

      logger.debug(
        `CRITICAL FIX: Using template timestamp ${template.timestamp}ms for daemon submission (XMRig used ${shareData.timestamp}s for hashing)`
      );
      logger.debug(
        `XMRig used: nonce=${nonce} (hex), timestamp=${shareData.timestamp}s, difficulty=${template.difficulty}`
      );
      logger.debug(
        `Daemon will receive: nonce=${parseInt(nonce, 16)} (decimal), timestamp=${template.timestamp}ms, difficulty=${template.difficulty}`
      );

      // Ensure no extra fields are present
      const expectedFields = [
        'index',
        'timestamp',
        'transactions',
        'previousHash',
        'nonce',
        'difficulty',
        'hash',
        'merkleRoot',
        'algorithm',
      ];
      const actualFields = Object.keys(blockData);
      const extraFields = actualFields.filter(field => !expectedFields.includes(field));

      if (extraFields.length > 0) {
        logger.warn(`Block data contains unexpected fields: ${extraFields.join(', ')}`);
        // Remove extra fields to ensure clean data
        extraFields.forEach(field => delete blockData[field]);
      }

      // SIMPLIFIED: Use miner's calculated hash directly since we now send structured data
      const minerHash = shareData.hash || shareData.result;

      // For daemon submission, recalculate hash with exact same parameters as miner
      const VeloraUtils = require('../utils/velora');
      const vu = new VeloraUtils();

      // Verify miner's hash using block difficulty (what miner actually used for hash calculation)
      const blockDifficulty = blockData.difficulty; // Miner now uses block difficulty for hash calculation

      const minerVerificationHash = vu.veloraHash(
        blockData.index,
        blockData.nonce,
        blockData.timestamp,
        blockData.previousHash,
        blockData.merkleRoot,
        blockDifficulty, // Use block difficulty for verification (same as miner)
        null
      );

      // Since miner and daemon both use block difficulty, verification hash = daemon hash
      const daemonHash = minerVerificationHash;

      // Set the daemon hash for submission
      blockData.hash = daemonHash;

                        // Log for debugging
      logger.debug(`Miner calculated hash: ${minerHash}`);
      logger.debug(`Pool verification hash (block difficulty ${blockDifficulty}): ${minerVerificationHash}`);
      logger.debug(`Daemon submission hash: ${daemonHash} (same as verification)`);
      logger.debug(`Miner hash verification: ${minerHash === minerVerificationHash ? '✅ MATCH' : '❌ MISMATCH'}`);

      if (minerHash === minerVerificationHash) {
        logger.debug(`✅ Miner hash verification SUCCESS - perfect match with block difficulty`);
        logger.debug(`Submitting to daemon: ${daemonHash}`);
      } else {
        logger.debug(`❌ Miner hash verification FAILED - parameters still mismatched`);
        logger.debug(`Using pool calculated hash anyway: ${daemonHash}`);
      }

      logger.debug(`Using daemon hash for submission: ${daemonHash}`);
      logger.debug(`Block data for hash calculation (matching XMRig parameters):`);
      logger.debug(`  Index: ${blockData.index}`);
      logger.debug(`  Nonce: ${blockData.nonce} (decimal, from hex ${nonce})`);
      logger.debug(`  Timestamp: ${template.timestamp}ms (template timestamp for daemon submission)`);
      logger.debug(`  Previous Hash: ${blockData.previousHash}`);
      logger.debug(`  Merkle Root: ${blockData.merkleRoot}`);
      logger.debug(`  Difficulty: ${blockData.difficulty}`);
      logger.debug(`  XMRig timestamp was: ${shareData.timestamp}s (used for hashing, not submission)`);

      logger.debug(
        `Built block data: index=${blockData.index}, nonce=${blockData.nonce} (decimal), hash=${blockData.hash?.substring(0, 16) || 'undefined'}...`
      );
      logger.debug(`Final hash value: ${blockData.hash}`);
      logger.debug(`Complete block data: ${JSON.stringify(blockData, null, 2)}`);

      return blockData;
    } catch (error) {
      logger.error(`Error building block data: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate block structure
   */
  validateBlockStructure(blockData) {
    const required = ['index', 'nonce', 'timestamp', 'hash', 'previousHash', 'merkleRoot', 'difficulty'];

    logger.debug(`Validating block structure. Block data keys: ${Object.keys(blockData)}`);
    logger.debug(`Block data: ${JSON.stringify(blockData, null, 2)}`);

    for (const field of required) {
      if (!blockData.hasOwnProperty(field)) {
        logger.warn(`Block missing required field: ${field}`);
        logger.warn(`Available fields: ${Object.keys(blockData)}`);
        return false;
      }
      logger.debug(`Field ${field}: ${blockData[field]}`);
    }

    return true;
  }

  /**
   * Get validation statistics
   */
  getStats() {
    return {
      ...this.stats,
      validShareRate: this.stats.totalShares > 0 ? (this.stats.validShares / this.stats.totalShares) * 100 : 0,
      uptime: Date.now() - (this.stats.lastBlockFound || Date.now()),
      blockSubmissionRate: this.stats.blocksFound > 0 ? (this.stats.blocksAccepted / this.stats.blocksFound) * 100 : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalShares: 0,
      validShares: 0,
      invalidShares: 0,
      staleShares: 0,
      blocksFound: 0,
      lastBlockFound: null,
      blocksSubmitted: 0,
      blocksAccepted: 0,
      blocksRejected: 0,
    };
    logger.info('Statistics reset');
  }

  /**
   * Get share difficulty for a given hash
   */
  getShareDifficulty(hash, targetDifficulty) {
    try {
      const hashValue = BigInt('0x' + hash);
      const target = BigInt(2) ** BigInt(256) / BigInt(targetDifficulty);
      const difficulty = Number(target / hashValue);
      return Math.max(1, Math.floor(difficulty));
    } catch (error) {
      return 1;
    }
  }

  /**
   * Submit block to daemon
   */
  async submitBlockToDaemon(shareData, template, minerAddress) {
    let blockHeight;
    try {
      blockHeight = template.index || 'unknown';
      logger.debug(`🚀 Submitting block to daemon for height ${blockHeight}...`);

      // Validate inputs
      if (!shareData || !template || !minerAddress) {
        logger.error('Missing required parameters for block submission');
        return {
          success: false,
          error: 'Missing required parameters'
        };
      }

      // Build block data for submission
      logger.debug(`Building block data for submission with template: ${JSON.stringify(template)}`);
      const blockData = this.buildBlockFromShare(shareData, template, minerAddress);

      if (!blockData) {
        logger.error('Failed to build block data for submission');
        return {
          success: false,
          error: 'Failed to build block data'
        };
      }

      logger.debug(`Block data built successfully: ${JSON.stringify(blockData)}`);

      // Validate block structure
      if (!this.validateBlockStructure(blockData)) {
        logger.error('Block structure validation failed');
        return {
          success: false,
          error: 'Block structure validation failed'
        };
      }

      // Submit block to the real daemon
      const daemonConfig = this.config.getDaemonConfig();
      if (!daemonConfig || !daemonConfig.url) {
        logger.error('Daemon configuration not available for block submission');
        return {
          success: false,
          error: 'Daemon configuration not available'
        };
      }

      // Test daemon connection first
      try {
        const healthResponse = await axios.get(`${daemonConfig.url}/api/health`, {
          timeout: 5000,
          headers: {
            'User-Agent': 'Pastella-Mining-Pool/1.0.0',
          }
        });
        logger.debug(`Daemon health check: ${healthResponse.status} - ${JSON.stringify(healthResponse.data)}`);
      } catch (healthError) {
        logger.warn(`Daemon health check failed: ${healthError.message}`);
        // Continue with block submission anyway
      }

      logger.debug(`📤 Submitting block ${blockHeight} to daemon...`);

      // Prepare headers for daemon request
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Pastella-Mining-Pool/1.0.0',
      };

      // Add authentication if configured
      if (daemonConfig.apiKey) {
        headers['X-API-Key'] = daemonConfig.apiKey;
      } else if (daemonConfig.username && daemonConfig.password) {
        const auth = Buffer.from(`${daemonConfig.username}:${daemonConfig.password}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
      }

      // Prepare block submission data - daemon expects data wrapped in 'block' field
      // and specific field names that match Block.fromJSON expectations
      // Note: Daemon will recalculate merkle root from transactions, so we don't send it
      const submissionData = {
        block: {
          index: blockData.index,
          hash: blockData.hash,
          previousHash: blockData.previousHash,
          timestamp: blockData.timestamp,
          nonce: blockData.nonce,
          difficulty: blockData.difficulty,
          transactions: blockData.transactions, // Use actual transactions from template
          algorithm: 'velora'
        }
      };

      logger.debug(`Submitting block data: ${JSON.stringify(submissionData)}`);

      // Make HTTP POST request to daemon
      const response = await axios.post(
        `${daemonConfig.url}/api/blocks/submit`,
        submissionData,
        {
          headers,
          timeout: daemonConfig.timeout || 30000,
        }
      );

            if (response.status === 200) {
        logger.info(`✅ Block ${blockHeight} ACCEPTED by daemon - block is valid!`);
        logger.debug(`Daemon response: ${JSON.stringify(response.data)}`);

        // Update statistics
        this.stats.blocksSubmitted++;
        this.stats.blocksAccepted++;

        // Return success result
        return {
          success: true,
          invalidateJobs: true,
          blockIndex: blockData.index,
          hash: blockData.hash,
          blockData: blockData,
          daemonResponse: response.data
        };
      } else {
        logger.error(`❌ Block ${blockHeight} REJECTED by daemon - block is invalid (status: ${response.status})`);
        logger.debug(`Daemon error response: ${JSON.stringify(response.data)}`);
        this.stats.blocksRejected++;

        return {
          success: false,
          error: `Daemon returned status ${response.status}: ${response.data?.error || 'Unknown error'}`,
          daemonResponse: response.data
        };
      }

    } catch (error) {
      logger.error(`❌ Block submission failed for height ${blockHeight || 'unknown'}: ${error.message}`);
      logger.debug(`Error stack: ${error.stack}`);

      // Update statistics for failed submissions
      this.stats.blocksRejected++;

      // Handle specific error types and provide better feedback
      let errorResult;
      if (error.code === 'ECONNREFUSED') {
        errorResult = {
          success: false,
          error: 'Cannot connect to daemon - connection refused',
          shouldRetry: false
        };
      } else if (error.code === 'ETIMEDOUT') {
        errorResult = {
          success: false,
          error: 'Daemon request timed out',
          shouldRetry: true
        };
      } else if (error.response) {
        // Daemon responded with error status - usually means invalid block
        const statusCode = error.response.status;
        const errorMessage = error.response.data?.error || 'Unknown error';
        
        if (statusCode === 400) {
          logger.warn(`❌ Block rejected by daemon - likely invalid block solution (status 400)`);
          logger.warn(`   Daemon message: ${errorMessage}`);
          logger.warn(`   This indicates the hash does not meet network difficulty requirements`);
        }
        
        errorResult = {
          success: false,
          error: `Daemon error: ${statusCode} - ${errorMessage}`,
          daemonResponse: error.response.data,
          shouldRetry: false, // Don't retry invalid blocks
          statusCode: statusCode
        };
      } else if (error.request) {
        // Request was made but no response received
        errorResult = {
          success: false,
          error: 'No response from daemon',
          shouldRetry: true
        };
      } else {
        // Other errors
        errorResult = {
          success: false,
          error: error.message,
          shouldRetry: false
        };
      }
      
      return errorResult;
    }
  }
}

module.exports = ShareValidator;
