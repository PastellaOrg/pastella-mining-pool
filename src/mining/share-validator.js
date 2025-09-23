const VeloraUtils = require('../utils/velora.js');
const logger = require('../utils/logger.js');
const axios = require('axios');

class ShareValidator {
  constructor(config, blockTemplateManager, stratumServer = null) {
    this.config = config;
    this.blockTemplateManager = blockTemplateManager;
    this.stratumServer = stratumServer; // 🎯 NEW: Reference to stratum server for job lookup
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
   * 🎯 CRITICAL FIX: Get original template used for mining from job ID
   * This ensures we use the EXACT same timestamp and parameters that were sent to miners
   */
  getOriginalJobTemplate(jobId) {
    if (!this.stratumServer) {
      return this.blockTemplateManager.getCurrentTemplate();
    }

    const job = this.stratumServer.jobs.get(jobId);
    if (!job) {
      return this.blockTemplateManager.getCurrentTemplate();
    }

    if (!job.originalTemplate) {
      return job.template || this.blockTemplateManager.getCurrentTemplate();
    }

    return job.originalTemplate;
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
      // Find miner ID by address or create new miner
      let miners = await this.databaseManager.getMiners();
      let miner = miners.find(m => m.address === minerAddress);

      if (!miner) {
        // Create new miner if not found
        logger.info(`Creating new miner record for address: ${minerAddress}`);
        await this.databaseManager.addMiner({
          address: minerAddress,
          first_seen: Date.now(),
          last_seen: Date.now(),
          shares: 0
        });
        
        // Reload miners to get the new miner with ID
        miners = await this.databaseManager.getMiners();
        miner = miners.find(m => m.address === minerAddress);
        
        if (!miner) {
          logger.error(`Failed to create or find miner: ${minerAddress}`);
          return;
        }
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

      // 🎯 CRITICAL FIX: Get ORIGINAL template from job ID to ensure timestamp consistency
      const template = this.getOriginalJobTemplate(shareData.jobId);
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
            // Still count it as a block found but don't submit again
            this.stats.blocksFound++;
            // Create a resolved promise to indicate this block is already being processed
            validationResult.blockSubmissionPromise = Promise.resolve({
              success: true,
              message: 'Block already being processed',
              duplicate: true
            });
            return validationResult;
          }

          // Add this height to processing set
          this.processingHeights.add(blockHeight);
          logger.debug(`Added height ${blockHeight} to processing set`);

          this.stats.blocksFound++;
          this.stats.lastBlockFound = Date.now();
          logger.info(`Block found by ${minerAddress} - hash: ${shareData.hash}`);

          // CRITICAL: Submit the block to the daemon and await result
          validationResult.blockSubmissionPromise = this.submitBlockToDaemon(shareData, template, minerAddress)
            .then((result) => {
              if (result && result.success) {
                logger.info(`Block ${blockHeight} accepted by daemon`);
              } else {
                logger.warn(`Block ${blockHeight} rejected by daemon: ${result?.error || 'Unknown error'}`);
              }
              return result;
            })
            .catch((error) => {
              logger.error(`Block ${blockHeight} submission error: ${error.message}`);
              return { success: false, error: error.message };
            })
            .finally(() => {
              // Remove height from processing set when submission is complete
              this.processingHeights.delete(blockHeight);
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

    for (const field of required) {
      if (!shareData.hasOwnProperty(field)) {
        return false;
      }
    }

    // Validate data types
    if (typeof shareData.nonce !== 'string' || shareData.nonce.length !== 8) {
      return false;
    }

    if (typeof shareData.hash !== 'string' || shareData.hash.length !== 64) {
      return false;
    }

    if (typeof shareData.difficulty !== 'number' || shareData.difficulty <= 0) {
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

      // Check if hash meets pool difficulty requirements (not network difficulty)
      const hashValue = BigInt('0x' + shareData.hash);
      const shareTarget = BigInt(2) ** BigInt(256) / BigInt(shareData.difficulty);

      if (hashValue > shareTarget) {
        return { valid: false, reason: 'Hash does not meet pool difficulty requirement' };
      }

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
      // First validate that the hash exists and is properly formatted
      if (!blockData.hash || blockData.hash.length !== 64) {
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

      if (hashValue > blockTarget) {
        return { valid: false, reason: 'Hash does not meet block difficulty requirement' };
      }

      // Update block difficulty to template difficulty for submission
      blockData.difficulty = template.difficulty;

      // Validate timestamp (should be close to template timestamp
      // Both timestamps are now in milliseconds, so we can compare directly
      const timeDiff = Math.abs(blockData.timestamp - template.timestamp);
      if (timeDiff > 300000) { // 5 minutes tolerance in milliseconds
        return { valid: false, reason: 'Block timestamp too old' };
      }

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

      // CRITICAL FIX: Use the job template timestamp that was sent to the miner
      // This should match what the miner used for hashing, but there's a miner bug
      // where it uses an inconsistent timestamp. For now, use the job template timestamp.
      const jobTimestamp = template.timestamp; // Use the job timestamp that was sent to miner

      const blockData = {
        index: template.index,
        timestamp: jobTimestamp, // Use job timestamp that should have been used by miner
        transactions: template.transactions || [],
        previousHash: template.previousHash,
        nonce: parseInt(nonce, 16), // Convert hex nonce to decimal for daemon
        difficulty: template.difficulty,
        hash: null, // Will be calculated after building complete block data
        merkleRoot: template.merkleRoot,
        algorithm: 'velora', // Required field for block validation
      };

      logger.debug(
      );
      logger.debug(
        `XMRig used: nonce=${nonce} (hex), nTime=${shareData.timestamp}s (different from job timestamp), difficulty=${template.difficulty}`
      );
      logger.debug(
        `Daemon will receive: nonce=${parseInt(nonce, 16)} (decimal), timestamp=${jobTimestamp}ms, difficulty=${template.difficulty}`
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

      // CRITICAL FIX: Use miner's calculated hash directly - don't recalculate!
      const minerHash = shareData.hash || shareData.result;
      
      if (!minerHash) {
        throw new Error('No hash provided by miner');
      }

      // TRUST THE MINER'S HASH: The miner has already done the proof-of-work
      // The daemon will validate the hash matches the block parameters
      blockData.hash = minerHash;

      // Log for debugging
      logger.debug(`Using miner hash directly for daemon submission: ${minerHash}`);
      logger.debug(`Block data for hash calculation:`);
      logger.debug(`  Index: ${blockData.index}`);
      logger.debug(`  Nonce: ${blockData.nonce} (decimal, from hex ${nonce})`);
      logger.debug(`  Timestamp: ${jobTimestamp}ms (job template timestamp for daemon submission)`);
      logger.debug(`  Previous Hash: ${blockData.previousHash}`);
      logger.debug(`  Merkle Root: ${blockData.merkleRoot}`);
      logger.debug(`  Difficulty: ${blockData.difficulty}`);
      logger.debug(`  Miner nTime was: ${shareData.timestamp * 1000}ms (not used for hash calculation)`);

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
        logger.info(`Block ${blockHeight} accepted by daemon`);
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
        logger.error(`Block ${blockHeight} rejected by daemon (status: ${response.status})`);
        logger.debug(`Daemon error response: ${JSON.stringify(response.data)}`);
        this.stats.blocksRejected++;

        return {
          success: false,
          error: `Daemon returned status ${response.status}: ${response.data?.error || 'Unknown error'}`,
          daemonResponse: response.data
        };
      }

    } catch (error) {
      logger.error(`Block submission failed for height ${blockHeight || 'unknown'}: ${error.message}`);
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
          logger.warn(`Block rejected by daemon - likely invalid block solution (status 400)`);
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
