const logger = require('../../utils/logger.js');

class AuthHandlers {
  constructor(server) {
    this.server = server;
  }

  async handleSubscribe(clientId, params, id) {
    const client = this.server.clients.get(clientId);
    if (!client) return;

    logger.debug(`Subscribe attempt from ${clientId}: params=${JSON.stringify(params)}, type=${typeof params}, isArray=${Array.isArray(params)}`);

    client.subscribed = true;

    this.server.sendToClient(clientId, {
      id: id,
      result: [[['mining.notify']], null, null],
      error: null,
    });

    logger.debug(`Client ${clientId} subscribed successfully`);
  }

  async handleAuthorize(clientId, params, id) {
    const client = this.server.clients.get(clientId);
    if (!client) return;

    logger.debug(`Authorize attempt from ${clientId}: params=${JSON.stringify(params)}, type=${typeof params}, isArray=${Array.isArray(params)}`);

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
      logger.debug(`Invalid params format for authorize from ${clientId}: ${JSON.stringify(params)}`);
      this.server.sendError(clientId, id, -1, 'Invalid authorize parameters');
      return;
    }

    if (!workerName) {
      this.server.sendError(clientId, id, -1, 'Worker name required');
      return;
    }

    client.authorized = true;
    client.workerName = workerName;
    client.address = workerName;

    if (this.server.databaseManager) {
      try {
        await this.server.databaseManager.addMiner({
          id: clientId,
          address: workerName,
          worker_name: workerName,
          hashrate: 0,
          shares: 0,
          last_seen: Date.now(),
          created_at: Date.now()
        });
        logger.debug(`Miner ${workerName} added to database with ID ${clientId}`);
      } catch (error) {
        logger.error(`Failed to add miner to database: ${error.message}`);
        logger.debug(`Error stack: ${error.stack}`);
      }
    }

    this.server.sendToClient(clientId, { id, result: true, error: null });
    logger.info(`✅ ${workerName} authorized (diff: ${client.difficulty || 1})`);
  }

  async handleLogin(clientId, params, id) {
    const client = this.server.clients.get(clientId);
    if (!client) return;

    logger.debug(`Login attempt from ${clientId}: params=${JSON.stringify(params)}, type=${typeof params}, isArray=${Array.isArray(params)}`);

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
      logger.debug(`Invalid params format for login from ${clientId}: ${JSON.stringify(params)}`);
      this.server.sendError(clientId, id, -1, 'Invalid login parameters');
      return;
    }

    if (!workerName) {
      this.server.sendError(clientId, id, -1, 'Worker name required');
      return;
    }

    client.authorized = true;
    client.workerName = workerName;
    client.address = workerName;

    if (this.server.databaseManager) {
      try {
        await this.server.databaseManager.addMiner({
          id: clientId,
          address: workerName,
          worker_name: workerName,
          hashrate: 0,
          shares: 0,
          last_seen: Date.now(),
          created_at: Date.now()
        });
        logger.debug(`Miner ${workerName} added to database with ID ${clientId}`);
      } catch (error) {
        logger.error(`Failed to add miner to database: ${error.message}`);
        logger.debug(`Error stack: ${error.stack}`);
      }
    }

    client.subscribed = true;
    client.subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    let currentJob = this.server.getCurrentJob();
    logger.debug(`Login: getCurrentJob() returned: ${currentJob ? currentJob.id : 'NULL'}`);

    if (!currentJob) {
      logger.debug(`Login: No current job available, attempting to create one now`);
      try {
        const template = this.server.blockTemplateManager.getCurrentTemplate();
        if (template) {
          const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const job = {
            id: jobId,
            template: template,
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
          logger.debug(`Login: Successfully created job ${currentJob.id} for client ${clientId}`);
        } else {
          logger.warn(`Login: No block template available for job creation`);
        }
      } catch (error) {
        logger.error(`Login: Error creating job: ${error.message}`);
      }
    }

    if (currentJob) {
      logger.debug(`Login: Job details - id: ${currentJob.id}, template: ${currentJob.template ? currentJob.template.index : 'NO_TEMPLATE'}`);
      this.server.sendToClient(clientId, {
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
      logger.warn(`Login: No current job available, sending response without job`);
      this.server.sendToClient(clientId, { id, result: { id: clientId, status: 'OK' }, error: null });
    }

    logger.debug(`Completed full login sequence for ${clientId}: job included in login response, client subscribed`);
    logger.info(`✅ ${workerName} logged in (diff: ${client.difficulty || 1})`);
  }
}

module.exports = AuthHandlers;


