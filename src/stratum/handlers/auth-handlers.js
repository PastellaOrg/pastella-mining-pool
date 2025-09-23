const logger = require('../../utils/logger.js');

class AuthHandlers {
  constructor(server) {
    this.server = server;
  }

  async handleSubscribe(clientId, params, id) {
    const client = this.server.clients.get(clientId);
    if (!client) return;

    client.subscribed = true;

    this.server.sendToClient(clientId, {
      id: id,
      result: [[['mining.notify']], null, null],
      error: null,
    });
  }

  async handleAuthorize(clientId, params, id) {
    const client = this.server.clients.get(clientId);
    if (!client) return;

    let workerName, password;
    if (Array.isArray(params)) {
      [workerName, password] = params;
    } else if (typeof params === 'object' && params !== null) {
      workerName = params.user || params.worker || params.login;
      password = params.pass || params.password;
    } else if (typeof params === 'string') {
      workerName = params;
      password = '';
    } else {
      this.server.sendError(clientId, id, -1, 'Invalid authorize parameters');
      return;
    }

    if (!workerName) {
      this.server.sendError(clientId, id, -1, 'Worker name required');
      return;
    }

    // Parse conventional mining format: address.workername or just address
    let walletAddress, actualWorkerName;
    if (workerName.includes('.')) {
      [walletAddress, actualWorkerName] = workerName.split('.', 2);
    } else {
      walletAddress = workerName;
      actualWorkerName = 'default';
    }
    
    // Normalize worker name to prevent duplicates - use consistent default name
    if (!actualWorkerName || actualWorkerName === 'default') {
      actualWorkerName = 'miner';
    }

    client.authorized = true;
    client.workerName = actualWorkerName;
    client.address = walletAddress;
    client.fullWorkerName = workerName;

    if (this.server.databaseManager) {
      try {
        // Use composite key format to prevent duplicates: address.worker_name
        const compositeKey = `${walletAddress}.${actualWorkerName}`;
        client.databaseId = compositeKey; // Store database ID for hashrate updates
        await this.server.databaseManager.addMiner({
          id: compositeKey,
          address: walletAddress,
          worker_name: actualWorkerName,
          hashrate: 0,
          shares: 0,
          last_seen: Date.now(),
          created_at: Date.now()
        });
      } catch (error) {
        logger.error(`Failed to add miner to database: ${error.message}`);
      }
    }

    this.server.sendToClient(clientId, { id, result: true, error: null });
    
    // Send initial difficulty to miner
    this.server.sendDifficulty(clientId, client.difficulty || 1);
    
    logger.info(`Miner authorized: ${walletAddress} (worker: ${actualWorkerName})`);
  }

  async handleLogin(clientId, params, id) {
    const client = this.server.clients.get(clientId);
    if (!client) return;

    let workerName, password;
    if (Array.isArray(params)) {
      [workerName, password] = params;
    } else if (typeof params === 'object' && params !== null) {
      workerName = params.user || params.worker || params.login;
      password = params.pass || params.password;
    } else if (typeof params === 'string') {
      workerName = params;
      password = '';
    } else {
      this.server.sendError(clientId, id, -1, 'Invalid login parameters');
      return;
    }

    if (!workerName) {
      this.server.sendError(clientId, id, -1, 'Worker name required');
      return;
    }

    // Parse conventional mining format: address.workername or just address
    let walletAddress, actualWorkerName;
    if (workerName.includes('.')) {
      [walletAddress, actualWorkerName] = workerName.split('.', 2);
    } else {
      walletAddress = workerName;
      actualWorkerName = 'default';
    }
    
    // Normalize worker name to prevent duplicates - use consistent default name
    if (!actualWorkerName || actualWorkerName === 'default') {
      actualWorkerName = 'miner';
    }

    client.authorized = true;
    client.workerName = actualWorkerName;
    client.address = walletAddress;
    client.fullWorkerName = workerName;

    if (this.server.databaseManager) {
      try {
        // Use composite key format to prevent duplicates: address.worker_name
        const compositeKey = `${walletAddress}.${actualWorkerName}`;
        client.databaseId = compositeKey; // Store database ID for hashrate updates
        await this.server.databaseManager.addMiner({
          id: compositeKey,
          address: walletAddress,
          worker_name: actualWorkerName,
          hashrate: 0,
          shares: 0,
          last_seen: Date.now(),
          created_at: Date.now()
        });
      } catch (error) {
        logger.error(`Failed to add miner to database: ${error.message}`);
      }
    }

    client.subscribed = true;
    client.subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    let currentJob = this.server.getCurrentJob();

    if (!currentJob) {
      try {
        const template = this.server.blockTemplateManager.getCurrentTemplate();
        if (template) {
          const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          // 🎯 CRITICAL FIX: Deep copy template to preserve original timestamp and parameters
          const originalTemplate = JSON.parse(JSON.stringify(template));
          const job = {
            id: jobId,
            template: template,
            originalTemplate: originalTemplate, // 🎯 NEW: Preserve original template for exact mining conditions
            createdAt: Date.now(),
            expiresAt: Date.now() + 300000,
            previousHash: template.previousblockhash || template.previousHash,
            nbits: (template.bits || template.difficulty || 0x1d00ffff).toString(16),
            ntime: Math.floor(template.curtime || template.timestamp || Date.now() / 1000),
            version: 1,
          };
          this.server.jobs.set(jobId, job);
          this.server.currentJobId = jobId;
          currentJob = job;
        }
      } catch (error) {
        logger.error(`Login: Error creating job: ${error.message}`);
      }
    }

    if (currentJob) {
      this.server.sendToClient(clientId, {
        id: id,
        result: {
          id: clientId,
          job: {
            job_id: currentJob.id,
            height: (currentJob.originalTemplate || currentJob.template).index,
            timestamp: (currentJob.originalTemplate || currentJob.template).timestamp,
            previous_hash: (currentJob.originalTemplate || currentJob.template).previousHash,
            merkle_root: (currentJob.originalTemplate || currentJob.template).merkleRoot,
            difficulty: (currentJob.originalTemplate || currentJob.template).difficulty,
            pool_difficulty: client.difficulty,
            algo: 'velora'
          },
          status: 'OK',
        },
        error: null,
      });
    } else {
      this.server.sendToClient(clientId, { id, result: { id: clientId, status: 'OK' }, error: null });
    }

    // Send initial difficulty to miner
    this.server.sendDifficulty(clientId, client.difficulty || 1);

    logger.info(`Miner logged in: ${walletAddress} (worker: ${actualWorkerName})`);
  }
}

module.exports = AuthHandlers;


