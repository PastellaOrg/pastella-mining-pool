const net = require('net');
const logger = require('../utils/logger.js');
const DifficultyManager = require('../mining/difficulty-manager');
const HashrateService = require('./hashrate/hashrate');
const BlockCoordinator = require('./blocks/block-coordinator');
const JobManager = require('./jobs/job-manager');
const AuthHandlers = require('./handlers/auth-handlers');
const SubmitHandlers = require('./handlers/submit-handlers');

class StratumServer {
  constructor(config) {
    this.config = config;
    this.server = null;
    this.clients = new Map();
    this.jobs = new Map();
    this.currentJobId = 0;

    // Components (set by pool.js)
    this.shareValidator = null;
    this.blockTemplateManager = null;
    this.difficultyManager = new DifficultyManager(config);
    this.databaseManager = null;
    this.processingHeights = new Set();

    // Statistics
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      totalShares: 0,
      validShares: 0,
      invalidShares: 0,
      blocksFound: 0,
    };

    // Hashrate tracking
    this.hashrateTracker = new Map(); // clientId -> { shares: [], lastUpdate: timestamp }

    // Services/Handlers
    this.hashrateService = new HashrateService(this);
    this.blockCoordinator = new BlockCoordinator(this);
    this.jobManager = new JobManager(this);
    this.authHandlers = new AuthHandlers(this);
    this.submitHandlers = new SubmitHandlers(this);
  }

  /**
   * Set share validator
   */
  setShareValidator(shareValidator) {
    this.shareValidator = shareValidator;
  }

  /**
   * Set block template manager
   */
  setBlockTemplateManager(blockTemplateManager) {
    this.blockTemplateManager = blockTemplateManager;
  }

  /**
   * Set database manager
   */
  setDatabaseManager(databaseManager) {
    this.databaseManager = databaseManager;
  }

  /**
   * Start the Stratum server
   */
  start() {
    try {
      const { port, host } = this.config.getComponentConfig('stratum');

      this.server = net.createServer(socket => {
        this.handleConnection(socket);
      });

      this.server.listen(port, host, () => {
        logger.info(`Stratum server started on ${host}:${port}`);
      });

      this.server.on('error', this.handleError.bind(this));

      // Create initial job immediately
      this.jobManager.createInitialJob();

      // Start job updates
      this.jobManager.startJobUpdates();
    } catch (error) {
      logger.error(`Error starting Stratum server: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Stop the Stratum server
   */
  stop() {
    try {
      if (this.server) {
        this.server.close();
        this.server = null;
      }

      // Close all client connections
      for (const [clientId, client] of this.clients.entries()) {
        try {
          if (client && client.socket) {
            client.socket.destroy();
          }
        } catch (error) {
          logger.error(`Error destroying socket for client ${clientId}: ${error.message}`);
        }
      }

      // Clear all clients
      this.clients.clear();
      this.jobs.clear();

      logger.info('Stratum server stopped');
    } catch (error) {
      logger.error(`Error stopping Stratum server: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Handle new TCP connections
   */
  handleConnection(socket) {
    try {
      const clientId = this.generateClientId();
      const clientInfo = {
        id: clientId,
        socket: socket,
        address: socket.remoteAddress || 'unknown',
        connectedAt: Date.now(),
        subscribed: false,
        authorized: false,
        workerName: null,
        difficulty: this.difficultyManager ? this.difficultyManager.registerClient(clientId) : 1,
        lastActivity: Date.now(),
        buffer: '', // Buffer for incomplete JSON messages
      };

      this.clients.set(clientId, clientInfo);
      this.stats.totalConnections++;
      this.stats.activeConnections++;

      logger.info(`🔗 Miner connected: ${clientInfo.address}`);

      // Send welcome message
      this.sendToClient(clientId, {
        id: null,
        result: {
          version: '1.0.0',
          protocol: 'stratum',
          server: 'Pastella Mining Pool',
        },
        error: null,
      });

      // Handle client messages
      socket.on('data', async data => {
        try {
          const rawData = data.toString();
          logger.debug(`Raw data from ${clientId}: ${rawData}`);
          logger.debug(`Data length: ${rawData.length} bytes, Data type: ${typeof rawData}`);
          logger.debug(`Raw data hex: ${Buffer.from(rawData).toString('hex')}`);
          clientInfo.buffer += rawData;
          await this.processBuffer(clientId);
          clientInfo.lastActivity = Date.now();
        } catch (error) {
          logger.error(`Error handling message from ${clientId}: ${error.message}`);
          logger.debug(`Error stack: ${error.stack}`);
          this.sendError(clientId, null, -1, 'Invalid JSON');
        }
      });

      // Handle client disconnect
      socket.on('close', () => {
        this.handleDisconnect(clientId);
      });

      socket.on('error', error => {
        const client = this.clients.get(clientId);
        const minerAddress = client ? (client.address || client.workerName || 'Unknown Miner') : 'Unknown Miner';
        logger.debug(`Miner disconnected: ${minerAddress} (client: ${clientId}): ${error.message}`);
        this.handleDisconnect(clientId);
      });
    } catch (error) {
      logger.error(`Error in handleConnection: ${error.message}`);
      logger.debug(`Error stack: ${error.stack}`);
      if (socket) {
        socket.destroy();
      }
    }
  }

  /**
   * Process buffer for complete JSON messages
   */
  async processBuffer(clientId) {
    try {
      const client = this.clients.get(clientId);
      if (!client) return;

      // Split buffer by newlines (Stratum protocol uses newline-separated JSON)
      const lines = client.buffer.split('\n');

      // Keep the last line in buffer (might be incomplete)
      client.buffer = lines.pop() || '';

      // Process complete lines
      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line.trim());
            logger.debug(`Received message from ${clientId}: ${JSON.stringify(message)}`);
            await this.handleMessage(clientId, message);
          } catch (error) {
            logger.debug(`JSON parse error from ${clientId}: ${error.message}, line: ${line}`);
            logger.debug(`Error stack: ${error.stack}`);
            this.sendError(clientId, null, -1, 'Invalid JSON');
          }
        }
      }
    } catch (error) {
      logger.error(`Error in processBuffer for client ${clientId}: ${error.message}`);
      logger.debug(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Handle client disconnect
   */
  handleDisconnect(clientId) {
    try {
      const client = this.clients.get(clientId);
      if (client) {
        const minerAddress = client.address || client.workerName || 'Unknown Miner';
        logger.info(`🔌 ${minerAddress} disconnected`);
        this.clients.delete(clientId);
        if (this.difficultyManager) {
          this.difficultyManager.unregisterClient(clientId);
        }
        this.stats.activeConnections--;
      } else {
        logger.debug(`Unknown client disconnected: ${clientId}`);
      }
    } catch (error) {
      logger.error(`Error in handleDisconnect for client ${clientId}: ${error.message}`);
      logger.debug(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Handle incoming messages
   */
  async handleMessage(clientId, message) {
    try {
      const { method, params, id } = message;

      logger.debug(
        `Processing message from ${clientId}: method=${method}, id=${id}, params=${JSON.stringify(params)}, paramsType=${typeof params}`
      );

      // Validate message structure
      if (!method) {
        logger.error(`Message missing method from ${clientId}: ${JSON.stringify(message)}`);
        this.sendError(clientId, id, -1, 'Missing method');
        return;
      }

      switch (method) {
        case 'mining.subscribe':
          await this.authHandlers.handleSubscribe(clientId, params, id);
          break;
        case 'mining.authorize':
          await this.authHandlers.handleAuthorize(clientId, params, id);
          break;
        case 'login':
          // Handle login method (alternative to mining.authorize)
          await this.authHandlers.handleLogin(clientId, params, id);
          break;
        case 'mining.submit':
        case 'submit': // xmrig uses 'submit' instead of 'mining.submit'
          await this.submitHandlers.handleSubmit(clientId, params, id);
          break;
        case 'mining.get_transactions':
          await this.submitHandlers.handleGetTransactions(clientId, id);
          break;
        case 'mining.suggest_difficulty':
          await this.handleSuggestDifficulty(clientId, params, id);
          break;
        default:
          logger.warn(`Unknown method from client ${clientId}: ${method}`);
          this.sendError(clientId, id, -1, 'Method not found');
      }
    } catch (error) {
      logger.error(`Error handling message from ${clientId}: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      this.sendError(clientId, message.id, -1, 'Internal error');
    }
  }

  /**
   * Handle mining.subscribe
   */
  async handleSubscribe(clientId, params, id) {
    const client = this.clients.get(clientId);
    if (!client) return;

    logger.debug(
      `Subscribe attempt from ${clientId}: params=${JSON.stringify(params)}, type=${typeof params}, isArray=${Array.isArray(params)}`
    );

    client.subscribed = true;

    // Send subscription response
    // NOTE: For Velora algorithm, XMRig generates its own nonces internally
    // We don't need to provide extraNonce ranges
    this.sendToClient(clientId, {
      id: id,
      result: [
        [['mining.notify']], // No extraNonce parameters for Velora
        null, // No extraNonce1
        null, // No extraNonce2Size
      ],
      error: null,
    });

    logger.info(`Client ${clientId} subscribed successfully`);
  }

  /**
   * Handle mining.authorize
   */
  async handleAuthorize(clientId, params, id) {
    const client = this.clients.get(clientId);
    if (!client) return;

    logger.debug(
      `Authorize attempt from ${clientId}: params=${JSON.stringify(params)}, type=${typeof params}, isArray=${Array.isArray(params)}`
    );

    // Handle different param formats
    let workerName, password;

    if (Array.isArray(params)) {
      [workerName, password] = params;
    } else if (typeof params === 'object' && params !== null) {
      // Handle case where params is an object
      workerName = params.user || params.worker || params.login;
      password = params.pass || params.password;
    } else if (typeof params === 'string') {
      // Handle case where params is just a string
      workerName = params;
      password = '';
    } else {
      logger.error(`Invalid params format for authorize from ${clientId}: ${JSON.stringify(params)}`);
      this.sendError(clientId, id, -1, 'Invalid authorize parameters');
      return;
    }

    if (!workerName) {
      this.sendError(clientId, id, -1, 'Worker name required');
      return;
    }

    // For now, accept any worker (in production, validate against database)
    client.authorized = true;
    client.workerName = workerName;
    // Store the wallet address (workerName is typically the wallet address in crypto mining)
    client.address = workerName;

    // Add miner to database
    if (this.databaseManager) {
      try {
        await this.databaseManager.addMiner({
          id: clientId,
          address: workerName, // Use workerName as the wallet address
          worker_name: workerName,
          hashrate: 0,
          shares: 0,
          last_seen: Date.now(),
          created_at: Date.now()
        });
        logger.info(`Miner ${workerName} added to database with ID ${clientId}`);
      } catch (error) {
        logger.error(`Failed to add miner to database: ${error.message}`);
        logger.error(`Error stack: ${error.stack}`);
      }
    }

    this.sendToClient(clientId, {
      id: id,
      result: true,
      error: null,
    });

    logger.info(`Miner '${workerName}' authorized successfully (client: ${clientId})`);
  }

  /**
   * Handle login method (alternative to mining.authorize)
   */
  async handleLogin(clientId, params, id) {
    const client = this.clients.get(clientId);
    if (!client) return;

    logger.debug(
      `Login attempt from ${clientId}: params=${JSON.stringify(params)}, type=${typeof params}, isArray=${Array.isArray(params)}`
    );

    // Handle different param formats
    let workerName, password;

    if (Array.isArray(params)) {
      [workerName, password] = params;
    } else if (typeof params === 'object' && params !== null) {
      // Handle case where params is an object
      workerName = params.user || params.worker || params.login;
      password = params.pass || params.password;
    } else if (typeof params === 'string') {
      // Handle case where params is just a string
      workerName = params;
      password = '';
    } else {
      logger.error(`Invalid params format for login from ${clientId}: ${JSON.stringify(params)}`);
      this.sendError(clientId, id, -1, 'Invalid login parameters');
      return;
    }

    if (!workerName) {
      this.sendError(clientId, id, -1, 'Worker name required');
      return;
    }

    // For now, accept any worker (in production, validate against database)
    client.authorized = true;
    client.workerName = workerName;
    // Store the wallet address (workerName is typically the wallet address in crypto mining)
    client.address = workerName;

    // Add miner to database
    if (this.databaseManager) {
      try {
        await this.databaseManager.addMiner({
          id: clientId,
          address: workerName, // Use workerName as the wallet address
          worker_name: workerName,
          hashrate: 0,
          shares: 0,
          last_seen: Date.now(),
          created_at: Date.now()
        });
        logger.info(`Miner ${workerName} added to database with ID ${clientId}`);
      } catch (error) {
        logger.error(`Failed to add miner to database: ${error.message}`);
        logger.error(`Error stack: ${error.stack}`);
      }
    }

    // Automatically subscribe the client after successful login
    client.subscribed = true;
    client.subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Send login response with job - xmrig expects this format
    let currentJob = this.getCurrentJob();
    logger.debug(`Login: getCurrentJob() returned: ${currentJob ? currentJob.id : 'NULL'}`);

    // If no job available, try to create one now (synchronously)
    if (!currentJob) {
      logger.info(`Login: No current job available, attempting to create one now`);
      try {
        const template = this.blockTemplateManager.getCurrentTemplate();
        if (template) {
          logger.debug(`Login: Template structure: ${JSON.stringify(template, null, 2)}`);
          // Create job immediately
          const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const job = {
            id: jobId,
            template: template,
            createdAt: Date.now(),
            expiresAt: Date.now() + 300000, // 5 minutes
            previousHash: template.previousblockhash || template.previousHash,
            nbits: (template.bits || template.difficulty || 0x1d00ffff).toString(16),
            ntime: Math.floor(template.curtime || template.timestamp || Date.now() / 1000),
            version: 1,
          };

          this.jobs.set(jobId, job);
          this.currentJobId = jobId;
          currentJob = job;

          logger.info(`Login: Successfully created job ${currentJob.id} for client ${clientId}`);
        } else {
          logger.warn(`Login: No block template available for job creation`);
        }
      } catch (error) {
        logger.error(`Login: Error creating job: ${error.message}`);
      }
    }

            if (currentJob) {
      logger.debug(
        `Login: Job details - id: ${currentJob.id}, template: ${currentJob.template ? currentJob.template.index : 'NO_TEMPLATE'}`
      );

            // XMRig expects job data in the login response (as per working cryptonote-nodejs-pool)
      this.sendToClient(clientId, {
        id: id,
        result: {
          id: clientId,
          job: {
            job_id: currentJob.id,
            height: currentJob.template.index,
            timestamp: currentJob.template.timestamp,
            previous_hash: currentJob.template.previousHash,
            merkle_root: currentJob.template.merkleRoot,
            difficulty: currentJob.template.difficulty,
            pool_difficulty: client.difficulty,
            algo: 'velora'
          },
          status: 'OK',
        },
        error: null,
      });

    } else {
      // Fallback if no job available
      logger.warn(`Login: No current job available, sending response without job`);
      this.sendToClient(clientId, {
        id: id,
        result: {
          id: clientId,
          status: 'OK',
        },
        error: null,
      });
    }

    // Log that we've completed the full login sequence
    logger.info(`Completed full login sequence for ${clientId}: job included in login response, client subscribed`);

    logger.info(`Miner '${workerName}' logged in successfully (client: ${clientId})`);
  }

  /**
   * Handle mining.submit
   */
  async handleSubmit() { /* moved to submit-handlers */ }

  /**
   * Calculate share hash using Velora algorithm
   */
  calculateShareHash(template, shareData, client) {
    try {
      if (!template || !shareData || !client || !this.shareValidator || !this.shareValidator.veloraUtils) {
        logger.error('Missing required components for share hash calculation');
        return null;
      }

      // This would use the Velora algorithm to calculate the hash
      // For now, return a placeholder - the real implementation would use VeloraUtils
      const nonce = parseInt(shareData.nonce || '0', 16) || 0;
      const timestamp = parseInt(shareData.nTime || '0', 16) || 0;

      // Use the share validator's Velora instance
      return this.shareValidator.veloraUtils.veloraHash(
        template.index || 0,
        nonce,
        timestamp,
        template.previousHash || 'unknown',
        template.merkleRoot || 'unknown',
        template.difficulty || 1,
        null
      );
    } catch (error) {
      logger.error(`Error calculating share hash: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      return null;
    }
  }

  /**
   * Handle block submission coordination with template updates
   */
  async handleBlockSubmission() { /* moved to block-coordinator */ }

  /**
   * Store found block in the database
   */
  async storeFoundBlock(blockData, clientId) {
    if (!this.databaseManager) {
      logger.warn('Database manager not available, cannot store block');
      return;
    }

    if (!blockData) {
      logger.error('No block data provided for storage');
      return;
    }

    try {
      const client = this.clients.get(clientId);
      if (!client) {
        logger.error(`Client ${clientId} not found for block storage - cannot store block`);
        return;
      }

      // Prepare block data for database storage with fallbacks
      const dbBlock = {
        height: blockData.index || blockData.height || 0,
        hash: blockData.hash || 'unknown',
        previous_hash: blockData.previousHash || blockData.previous_hash || 'unknown',
        merkle_root: blockData.merkleRoot || blockData.merkle_root || 'unknown',
        timestamp: blockData.timestamp || Date.now(),
        nonce: (blockData.nonce || 0).toString(),
        difficulty: blockData.difficulty || 0,
        found_by: client.address || clientId, // Use miner's wallet address, fallback to client ID
        status: 'found' // Will be updated to 'confirmed' when daemon accepts it
      };

      // Store the block in the database
      await this.databaseManager.addBlock(dbBlock);
      logger.info(`✅ Block stored in database: height ${dbBlock.height}, hash ${dbBlock.hash.substring(0, 16)}...`);

      // Update pool statistics
      await this.updatePoolStatistics();

    } catch (error) {
      logger.error(`❌ Failed to store block in database: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      // Don't throw error to prevent server crash, just log it
    }
  }

  /**
   * Update pool statistics in the database
   */
  async updatePoolStatistics() {
    if (!this.databaseManager) {
      return;
    }

    try {
      const stats = {
        total_hashrate: this.calculateTotalHashrate(),
        active_miners: this.clients.size,
        total_shares: this.stats.totalShares || 0,
        valid_shares: this.stats.validShares || 0,
        invalid_shares: this.stats.invalidShares || 0,
        blocks_found: this.stats.blocksFound || 0,
        timestamp: Date.now()
      };

      await this.databaseManager.updatePoolStats(stats);
      logger.debug('Pool statistics updated in database');

    } catch (error) {
      logger.error(`Failed to update pool statistics: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Calculate hashrate for a specific miner based on share submission rate
   */
  calculateMinerHashrate(clientId) { return this.hashrateService.calculateMinerHashrate(clientId); }

  /**
   * Calculate total hashrate from all connected miners
   */
  calculateTotalHashrate() { return this.hashrateService.calculateTotalHashrate(); }

  /**
   * Record a share for hashrate calculation
   */
  recordShareForHashrate(clientId, difficulty) { this.hashrateService.recordShareForHashrate(clientId, difficulty); }

  /**
   * Update all miner hashrates in the database
   */
  async updateMinerHashratesInDatabase() { await this.hashrateService.updateMinerHashratesInDatabase(); }

  /**
   * Invalidate all jobs for a specific height to prevent duplicate submissions
   */
  invalidateJobsForHeight(height) {
    let invalidatedCount = 0;
    try {
      for (const [jobId, job] of this.jobs.entries()) {
        if (job && job.template && job.template.index === height) {
          this.jobs.delete(jobId);
          invalidatedCount++;
        }
      }
      logger.info(`🚫 Invalidated ${invalidatedCount} jobs for height ${height}`);
    } catch (error) {
      logger.error(`Error invalidating jobs for height ${height}: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Force immediate job update with fresh template
   */
  async forceJobUpdate() {
    try {
      // Force template refresh
      await this.blockTemplateManager.forceUpdate();

      // Get new template
      const template = this.blockTemplateManager.getCurrentTemplate();
      if (!template) {
        logger.error('❌ No template available for job update');
        return;
      }

      // Create new job
      const jobId = this.generateJobId();
      const job = {
        id: jobId,
        template: template,
        transactions: template.transactions || [],
        previousHash: template.previousHash || 'unknown',
        merkleRoot: template.merkleRoot || 'unknown',
        version: 1,
        nbits: this.difficultyToBits(template.difficulty || 1),
        ntime: Math.floor((template.timestamp || Date.now()) / 1000),
        cleanJobs: true,
        expiresAt: template.expiresAt || Date.now() + 300000, // 5 minutes default
      };

      this.jobs.set(jobId, job);
      this.cleanupOldJobs();
      this.broadcastNewJob(job);
      logger.info(`🚀 Immediate job update completed: ${job.id}, height: ${template.index}`);
    } catch (error) {
      logger.error(`Error in force job update: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Submit block to daemon
   */
  async submitBlock(template, shareData, client) {
    try {
      if (!template || !shareData || !client) {
        logger.error('Missing required parameters for block submission');
        return;
      }

      // Create block data with fallbacks
      const blockData = {
        index: template.index || 0,
        timestamp: parseInt(shareData.nTime || '0', 16) * 1000 || Date.now(),
        previousHash: template.previousHash || 'unknown',
        merkleRoot: template.merkleRoot || 'unknown',
        difficulty: template.difficulty || 1,
        nonce: parseInt(shareData.nonce || '0', 16) || 0,
        transactions: template.transactions || [],
        minerAddress: client.address || client.workerName || 'unknown',
      };

      // Validate block solution
      const blockValidation = this.shareValidator.validateBlockSolution(blockData, client.address || client.workerName);

      if (blockValidation.valid) {
        logger.info(`Block solution validated, submitting to daemon...`);

        // TODO: Submit block to daemon via API
        // This would make an HTTP POST to /api/blocks/submit

        logger.info(`Block submitted successfully!`);
      } else {
        logger.error(`Block validation failed: ${blockValidation.reason}`);
      }
    } catch (error) {
      logger.error(`Error submitting block: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Handle mining.get_transactions
   */
  async handleGetTransactions() { /* moved to submit-handlers */ }

  /**
   * Handle mining.suggest_difficulty
   */
  async handleSuggestDifficulty(clientId, params, id) {
    const client = this.clients.get(clientId);
    if (!client || !client.authorized) {
      this.sendError(clientId, id, -1, 'Not authorized');
      return;
    }

    const [suggestedDifficulty] = params;

    if (typeof suggestedDifficulty === 'number' && suggestedDifficulty > 0) {
      // Update client difficulty (with limits)
      const minDifficulty = 1;
      const maxDifficulty = 1000000;
      const newDifficulty = Math.max(minDifficulty, Math.min(maxDifficulty, suggestedDifficulty));

      client.difficulty = newDifficulty;

      this.sendToClient(clientId, {
        id: id,
        result: true,
        error: null,
      });

      logger.info(`Client ${clientId} difficulty updated to ${newDifficulty}`);
    } else {
      this.sendError(clientId, id, -1, 'Invalid difficulty value');
    }
  }

  /**
   * Create initial job when pool starts
   */
  createInitialJob() { /* moved to job-manager */ }

  /**
   * Start job updates
   */
  startJobUpdates() { /* moved to job-manager */ }

  /**
   * Update mining jobs
   */
  updateJobs() { /* moved to job-manager */ }

  /**
   * Clean up old jobs
   */
  cleanupOldJobs() { /* moved to job-manager */ }

    /**
   * Broadcast new job to all clients
   */
  broadcastNewJob(job) {
    return this.jobManager.broadcastNewJob(job);
  }

  /**
   * Send job to specific client
   */
  sendJobToClient(clientId) {
    try {
      if (!clientId) {
        logger.error('Invalid clientId for sendJobToClient');
        return;
      }

      logger.info(`Attempting to send job to client ${clientId}...`);

      let currentJob = this.getCurrentJob();
      logger.info(`Current job: ${currentJob ? currentJob.id : 'NONE'}`);

      // If no job exists, try to create one
      if (!currentJob) {
        logger.info(`No current job available, attempting to create one for ${clientId}`);
        this.createInitialJob();
        currentJob = this.getCurrentJob();

        if (!currentJob) {
          logger.warn(`Still no job available for ${clientId}`);
          return;
        }
        logger.info(`Successfully created job ${currentJob.id} for ${clientId}`);
      }

      const client = this.clients.get(clientId);
      if (!client) {
        logger.error(`Client ${clientId} not found when trying to send job`);
        return;
      }

      if (!client.subscribed) {
        logger.warn(`Client ${clientId} not subscribed, cannot send job`);
        return;
      }

      logger.info(`Client ${clientId} is ready to receive job ${currentJob.id}`);

      // Job is now sent in the login response, so this function is simplified
      logger.info(`Client ${clientId} is ready to receive job updates`);
      logger.info(`Job ${currentJob.id} was already sent in login response`);
    } catch (error) {
      logger.error(`Error in sendJobToClient for client ${clientId}: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Get current job
   */
  getCurrentJob() {
    try {
      // Return the most recent job
      let latestJob = null;
      let latestTime = 0;

      logger.debug(`getCurrentJob: Total jobs in map: ${this.jobs.size}`);

      for (const [jobId, job] of this.jobs.entries()) {
        try {
          if (!job || !job.template) {
            logger.warn(`Invalid job structure for job ${jobId}, removing`);
            this.jobs.delete(jobId);
            continue;
          }

          logger.debug(
            `getCurrentJob: Checking job ${jobId}, timestamp: ${job.template.timestamp}, expiresAt: ${job.expiresAt}, currentTime: ${Date.now()}`
          );

          // Check if job is expired
          if (Date.now() > job.expiresAt) {
            logger.debug(`getCurrentJob: Job ${jobId} is expired, removing`);
            this.jobs.delete(jobId);
            continue;
          }

          if (job.template.timestamp > latestTime) {
            latestTime = job.template.timestamp;
            latestJob = job;
          }
        } catch (error) {
          logger.error(`Error processing job ${jobId}: ${error.message}`);
          // Remove problematic job
          this.jobs.delete(jobId);
        }
      }

      logger.debug(`getCurrentJob: Returning job: ${latestJob ? latestJob.id : 'NULL'}`);
      return latestJob;
    } catch (error) {
      logger.error(`Error in getCurrentJob: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      return null;
    }
  }

  /**
   * Convert difficulty to nbits format
   */
  difficultyToBits(difficulty) {
    try {
      if (!difficulty || difficulty <= 0) {
        logger.warn(`Invalid difficulty for difficultyToBits: ${difficulty}`);
        return '1d00ffff'; // Default difficulty
      }
      // Simplified conversion - in production, use proper difficulty calculation
      const target = Math.floor(0xffffffff / difficulty);
      return target.toString(16);
    } catch (error) {
      logger.error(`Error in difficultyToBits: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      return '1d00ffff'; // Default difficulty
    }
  }

  /**
   * Convert difficulty to target format
   */
  difficultyToTarget(difficulty) {
    try {
      if (!difficulty || difficulty <= 0) {
        logger.warn(`Invalid difficulty for difficultyToTarget: ${difficulty}`);
        return 'ffffffff'; // Default target
      }
      // Convert difficulty to target (reverse of difficulty calculation)
      const target = Math.floor(0xffffffff / difficulty);
      return target.toString(16);
    } catch (error) {
      logger.error(`Error in difficultyToTarget: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      return 'ffffffff'; // Default target
    }
  }



  /**
   * Send message to specific client
   */
  sendToClient(clientId, message) {
    try {
      if (!clientId || !message) {
        logger.error('Invalid parameters for sendToClient');
        return;
      }

      const client = this.clients.get(clientId);
      if (client && client.socket && !client.socket.destroyed) {
        try {
          let rpcMessage;

          if (message.method) {
            // Method-based message (like mining.notify, mining.set_difficulty)
            rpcMessage = {
              jsonrpc: '2.0',
              method: message.method,
              params: message.params || [],
              id: message.id,
            };
          } else {
            // Response message (like login response, error response)
            rpcMessage = {
              jsonrpc: '2.0',
              result: message.result,
              error: message.error,
              id: message.id,
            };
          }

          const jsonMessage = JSON.stringify(rpcMessage) + '\n';
          logger.debug(`Sending to ${clientId}: ${jsonMessage.trim()}`);
          client.socket.write(jsonMessage);
          logger.debug(`Message sent successfully to ${clientId}`);
        } catch (error) {
          logger.error(`Error sending message to ${clientId}: ${error.message}`);
          logger.error(`Error stack: ${error.stack}`);
        }
      } else {
        logger.error(
          `Cannot send to ${clientId}: client=${!!client}, socket=${!!client?.socket}, destroyed=${client?.socket?.destroyed}`
        );
      }
    } catch (error) {
      logger.error(`Error in sendToClient for ${clientId}: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Send difficulty setting to client
   */
  sendDifficulty(clientId, difficulty) {
    try {
      if (!clientId || !difficulty) {
        logger.error('Invalid parameters for sendDifficulty');
        return;
      }
      this.sendToClient(clientId, {
        id: null,
        method: 'mining.set_difficulty',
        params: [difficulty],
      });
      logger.debug(`Set difficulty ${difficulty} for client ${clientId}`);
    } catch (error) {
      logger.error(`Error in sendDifficulty for client ${clientId}: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Send error to client
   */
  sendError(clientId, id, code, message) {
    try {
      if (!clientId) {
        logger.error('Invalid clientId for sendError');
        return;
      }
      this.sendToClient(clientId, {
        id: id,
        result: null,
        error: [code || -1, message || 'Unknown error', null],
      });
    } catch (error) {
      logger.error(`Error in sendError for client ${clientId}: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Generate unique client ID
   */
  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique job ID
   */
  generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // NOTE: For Velora algorithm, XMRig generates its own nonces internally
  // No extraNonce system needed



  /**
   * Generate seed hash for Velora algorithm (epoch-based)
   */
  generateSeedHash(blockNumber) {
    try {
      if (!blockNumber || typeof blockNumber !== 'number') {
        logger.error('Invalid blockNumber for generateSeedHash');
        return '0'.repeat(64);
      }

      // CORRECTED: Use 2016 as per VELORA_ALGO.md specification
      const epoch = Math.floor(blockNumber / 2016);
      const seedString = `velora-epoch-${epoch}`;

      // Create a deterministic hash for the epoch
      const crypto = require('crypto');
      const seedHash = crypto.createHash('sha256').update(seedString).digest('hex');

      logger.debug(`Generated seed hash for block ${blockNumber}, epoch ${epoch}: ${seedHash.substring(0, 16)}...`);
      return seedHash;
    } catch (error) {
      logger.error(`Error generating seed hash: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      // Fallback to a simple hash
      return '0'.repeat(64);
    }
  }

  /**
   * Handle server errors
   */
  handleError(error) {
    try {
      if (error) {
        logger.error(`Server error: ${error.message}`);
        logger.error(`Error stack: ${error.stack}`);
      } else {
        logger.error('Unknown server error occurred');
      }
    } catch (err) {
      logger.error(`Error in handleError: ${err.message}`);
      logger.error(`Error stack: ${err.stack}`);
    }
  }

  /**
   * Get server statistics
   */
  getStats() {
    try {
      return {
        ...this.stats,
        jobs: this.jobs ? this.jobs.size : 0,
        uptime: Date.now() - (this.stats.lastBlockFound || Date.now()),
      };
    } catch (error) {
      logger.error(`Error getting server stats: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      return {
        totalConnections: 0,
        activeConnections: 0,
        totalShares: 0,
        validShares: 0,
        invalidShares: 0,
        blocksFound: 0,
        jobs: 0,
        uptime: 0,
      };
    }
  }
}

module.exports = StratumServer;
