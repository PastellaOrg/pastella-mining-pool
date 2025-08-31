const logger = require('../../utils/logger.js');

class SubmitHandlers {
  constructor(server) {
    this.server = server;
  }

  async handleGetTransactions(clientId, id) {
    const client = this.server.clients.get(clientId);
    if (!client || !client.authorized) {
      this.server.sendError(clientId, id, -1, 'Not authorized');
      return;
    }
    const currentJob = this.server.getCurrentJob();
    if (currentJob) {
      this.server.sendToClient(clientId, { id, result: currentJob.transactions, error: null });
    } else {
      this.server.sendError(clientId, id, -1, 'No job available');
    }
  }

  async handleSubmit(clientId, params, id) {
    const client = this.server.clients.get(clientId);
    if (!client || !client.authorized) {
      this.server.sendError(clientId, id, -1, 'Not authorized');
      return;
    }

    logger.debug(`Submit params type: ${typeof params}, value: ${JSON.stringify(params)}`);

    let workerName, jobId, extraNonce2, nTime, nonce, result;
    if (Array.isArray(params)) {
      [workerName, jobId, extraNonce2, nTime, nonce] = params;
    } else if (typeof params === 'object' && params !== null) {
      workerName = params.workerName || params.worker || params.user || params.id || client.workerName;
      jobId = params.jobId || params.job_id;
      extraNonce2 = params.extraNonce2 || params.extra_nonce2 || params.nonce2 || '00000000';
      nTime = params.nTime || params.time || params.timestamp || Math.floor(Date.now() / 1000).toString(16);
      nonce = params.nonce;
      result = params.result;
    } else {
      logger.error(`Invalid submit params format: ${typeof params}`);
      this.server.sendError(clientId, id, -1, 'Invalid parameters format');
      return;
    }

    logger.debug(`Extracted params - worker: ${workerName}, jobId: ${jobId}, extraNonce2: ${extraNonce2}, nTime: ${nTime}, nonce: ${nonce}, result: ${result}`);

    if (!workerName || !jobId || !extraNonce2 || !nTime || !nonce) {
      logger.debug(`Missing required parameters - worker: ${!!workerName}, jobId: ${!!jobId}, extraNonce2: ${!!extraNonce2}, nTime: ${!!nTime}, nonce: ${!!nonce}`);
      this.server.sendError(clientId, id, -1, 'Missing parameters');
      return;
    }

    const job = this.server.jobs.get(jobId);
    if (!job) {
      this.server.sendError(clientId, id, -1, 'Job not found');
      return;
    }
    if (Date.now() > job.expiresAt) {
      this.server.sendError(clientId, id, -1, 'Job expired');
      return;
    }

    const nTimeValue = parseInt(nTime, 16);
    const shareData = {
      jobId: jobId,
      nonce: nonce,
      timestamp: nTimeValue,
      extraNonce2: extraNonce2,
      nTime: nTime,
      workerName: workerName,
    };

    logger.debug(`Share data timestamp: ${shareData.timestamp} (from nTime: ${nTime})`);

    try {
      const template = this.server.blockTemplateManager.getCurrentTemplate();
      if (!template) {
        this.server.sendError(clientId, id, -1, 'No block template available');
        return;
      }

      const hash = result;
      shareData.hash = hash;
      shareData.difficulty = client.difficulty || 1;

      logger.debug(`XMRig submitted hash: ${hash}`);
      logger.debug(`Share nonce: ${nonce}, timestamp: ${shareData.timestamp}`);
      logger.debug(`Job template timestamp: ${template.timestamp}`);

      if (!this.server.shareValidator) {
        logger.error('Share validator not available');
        this.server.sendError(clientId, id, -1, 'Share validation not available');
        return;
      }

      const validation = this.server.shareValidator.validateShare(shareData, client.address || client.workerName);

      if (this.server.difficultyManager) {
        this.server.difficultyManager.recordShare(clientId, validation.valid);
      }

      if (validation.valid) {
        this.server.stats.validShares++;
        this.server.hashrateService.recordShareForHashrate(clientId, client.difficulty || 1);

        if (this.server.difficultyManager) {
          const adjustment = this.server.difficultyManager.checkDifficultyAdjustment(clientId);
          if (adjustment && adjustment.adjusted) {
            client.difficulty = adjustment.newDifficulty;
            logger.info(`⚡ ${client.address || client.workerName} difficulty adjusted: ${adjustment.oldDifficulty} → ${adjustment.newDifficulty}`);
          }
        }

        if (validation.isBlockSolution) {
          const template = this.server.blockTemplateManager.getCurrentTemplate();
          const blockHeight = template ? template.index : null;
          if (blockHeight !== null && this.server.processingHeights.has(blockHeight)) {
            logger.warn(`⚠️ Block solution for height ${blockHeight} already being processed, skipping duplicate submission`);
            this.server.stats.blocksFound++;
            return;
          }

          this.server.stats.blocksFound++;
          logger.info(`🎉 BLOCK FOUND by ${client.address || client.workerName} at height ${blockHeight}`);
          logger.debug(`Block hash: ${hash}, nonce: ${nonce}, timestamp: ${shareData.timestamp}`);

          this.server.sendToClient(clientId, { id, result: { status: 'WAIT' }, error: null });

          if (validation.blockSubmissionPromise) {
            this.server.blockCoordinator.handleBlockSubmission(validation.blockSubmissionPromise, clientId);
          } else {
            logger.warn('No block submission promise available for block solution');
          }
          return;
        }

        this.server.sendToClient(clientId, { id, result: { status: 'OK' }, error: null });
        logger.info(`✅ Share accepted from ${client.address || client.workerName} (diff: ${client.difficulty || 1})`);
      } else {
        this.server.stats.invalidShares++;
        this.server.sendError(clientId, id, -1, `Invalid share: ${validation.reason}`);
        logger.info(`❌ Share rejected from ${client.address || client.workerName} (diff: ${client.difficulty || 1}): ${validation.reason}`);
      }
    } catch (error) {
      logger.error(`❌ Share processing error from ${client.address || client.workerName}: ${error.message}`);
      logger.debug(`Error stack: ${error.stack}`);
      this.server.sendError(clientId, id, -1, 'Share processing error');
    }

    this.server.stats.totalShares++;
  }
}

module.exports = SubmitHandlers;




