const logger = require('../../utils/logger.js');

class BlockCoordinator {
  constructor(server) {
    this.server = server;
  }

  async handleBlockSubmission(blockSubmissionPromise, clientId) {
    const template = this.server.blockTemplateManager.getCurrentTemplate();
    const blockHeight = template ? template.index : null;

    if (blockHeight !== null && this.server.processingHeights.has(blockHeight)) {
      logger.warn(`⚠️ Block submission for height ${blockHeight} already in progress, skipping duplicate submission`);
      return;
    }

    if (blockHeight !== null) {
      this.server.processingHeights.add(blockHeight);
      logger.debug(`Added height ${blockHeight} to processing set`);
    }

    try {
      logger.debug('Handling block submission - waiting for daemon response...');
      const submissionResult = await blockSubmissionPromise;

      if (submissionResult && submissionResult.success && submissionResult.invalidateJobs) {
        logger.info(`🚫 Block VALIDATED by daemon! Invalidating all jobs for height ${submissionResult.blockIndex}`);

        if (this.server.databaseManager && submissionResult.blockData) {
          try {
            await this.server.storeFoundBlock(submissionResult.blockData, clientId);
            const hash = submissionResult.hash || submissionResult.blockData.hash || 'unknown';
            logger.debug(`Block stored in database: height ${submissionResult.blockIndex}, hash ${hash.substring(0, 16)}...`);
          } catch (dbError) {
            logger.error(`❌ Failed to store block in database: ${dbError.message}`);
          }
        }

        this.server.invalidateJobsForHeight(submissionResult.blockIndex);
        logger.debug('Forcing immediate job update after successful block submission');
        await this.server.forceJobUpdate();
        return;
      } else if (submissionResult && !submissionResult.success) {
        // Block was rejected by daemon - handle gracefully
        logger.warn(`❌ Block submission failed: ${submissionResult.error}`);
        
        if (submissionResult.statusCode === 400) {
          logger.warn(`⚠️ Invalid block solution - hash likely doesn't meet network difficulty`);
        }
        
        // CRITICAL FIX: Send fresh jobs to miners immediately after failed block
        logger.info(`🚀 Sending fresh jobs to miners after failed block submission...`);
        
        // Force template update to get latest block template
        await this.server.blockTemplateManager.forceUpdate();
        const newTemplate = this.server.blockTemplateManager.getCurrentTemplate();
        
        if (newTemplate) {
          // Generate new job with fresh template
          const jobId = this.server.generateJobId();
          const job = {
            id: jobId,
            template: newTemplate,
            transactions: newTemplate.transactions || [],
            previousHash: newTemplate.previousHash || 'unknown',
            merkleRoot: newTemplate.merkleRoot || 'unknown',
            version: 1,
            nbits: this.server.difficultyToBits(newTemplate.difficulty || 1),
            ntime: Math.floor((newTemplate.timestamp || Date.now()) / 1000),
            cleanJobs: true, // Tell miners to abandon current work
            expiresAt: newTemplate.expiresAt || Date.now() + 300000,
          };
          
          this.server.jobs.set(jobId, job);
          this.server.jobManager.cleanupOldJobs();
          
          // Broadcast new job to all connected miners
          const broadcastResult = this.server.broadcastNewJob(job);
          logger.info(`📡 Fresh job sent to miners after failed block (height: ${newTemplate.index}, diff: ${newTemplate.difficulty})`);
        }
        
        logger.info(`Continuing normal operation after failed block submission...`);
      }

      logger.debug('Block submitted to daemon, waiting for processing...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const oldTemplate = this.server.blockTemplateManager.getCurrentTemplate();
      const oldHeight = oldTemplate ? oldTemplate.index : 0;
      logger.debug(`Current template before refresh: height=${oldHeight}, hash=${oldTemplate?.previousHash?.substring(0,16)}...`);

      logger.debug('Forcing template update from daemon...');
      await this.server.blockTemplateManager.forceUpdate();

      const newTemplate = this.server.blockTemplateManager.getCurrentTemplate();
      const newHeight = newTemplate ? newTemplate.index : 0;
      logger.debug(`Template after refresh: height=${newHeight}, hash=${newTemplate?.previousHash?.substring(0,16)}...`);

      if (newHeight > oldHeight) {
        logger.debug(`New block template detected! Height: ${oldHeight} -> ${newHeight}`);
        const jobId = this.server.generateJobId();
        const job = {
          id: jobId,
          template: newTemplate,
          transactions: newTemplate.transactions || [],
          previousHash: newTemplate.previousHash || 'unknown',
          merkleRoot: newTemplate.merkleRoot || 'unknown',
          version: 1,
          nbits: this.server.difficultyToBits(newTemplate.difficulty || 1),
          ntime: Math.floor((newTemplate.timestamp || Date.now()) / 1000),
          cleanJobs: true,
          expiresAt: newTemplate.expiresAt || Date.now() + 300000,
        };

        this.server.jobs.set(jobId, job);
        this.server.jobManager.cleanupOldJobs();
        this.server.broadcastNewJob(job);
        logger.debug(`New job broadcasted after block submission: ${job.id}`);
      } else {
        logger.warn(`⚠️ Template unchanged after block submission (height: ${newHeight})`);
        logger.warn('This might indicate the daemon has not yet processed the submitted block');

        logger.info('Waiting additional 2 seconds and trying again...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        await this.server.blockTemplateManager.forceUpdate();
        const retryTemplate = this.server.blockTemplateManager.getCurrentTemplate();
        const retryHeight = retryTemplate ? retryTemplate.index : 0;

        if (retryHeight > oldHeight) {
          logger.info(`✅ New template found on retry! Height: ${oldHeight} -> ${retryHeight}`);
          const retryJobId = this.server.generateJobId();
          const retryJob = {
            id: retryJobId,
            template: retryTemplate,
            transactions: retryTemplate.transactions || [],
            previousHash: retryTemplate.previousHash || 'unknown',
            merkleRoot: retryTemplate.merkleRoot || 'unknown',
            version: 1,
            nbits: this.server.difficultyToBits(retryTemplate.difficulty || 1),
            ntime: Math.floor((retryTemplate.timestamp || Date.now()) / 1000),
            cleanJobs: true,
            expiresAt: retryTemplate.expiresAt || Date.now() + 300000,
          };

          this.server.jobs.set(retryJobId, retryJob);
          this.server.jobManager.cleanupOldJobs();
          this.server.broadcastNewJob(retryJob);
          logger.info(`🚀 New job broadcasted after retry: ${retryJob.id}`);
        } else {
          logger.warn(`⚠️ Template still unchanged after retry - this is normal if block was rejected by daemon`);
          
          // CRITICAL FIX: Even if template unchanged, generate fresh job with new ID
          // This ensures miners get a new job and don't get stuck on the old one
          logger.info(`🚀 Sending fresh job to miners even with unchanged template...`);
          
          const freshJobId = this.server.generateJobId();
          const freshJob = {
            id: freshJobId,
            template: retryTemplate,
            transactions: retryTemplate.transactions || [],
            previousHash: retryTemplate.previousHash || 'unknown',
            merkleRoot: retryTemplate.merkleRoot || 'unknown',
            version: 1,
            nbits: this.server.difficultyToBits(retryTemplate.difficulty || 1),
            ntime: Math.floor((retryTemplate.timestamp || Date.now()) / 1000),
            cleanJobs: true, // Force miners to start fresh work
            expiresAt: retryTemplate.expiresAt || Date.now() + 300000,
          };
          
          this.server.jobs.set(freshJobId, freshJob);
          this.server.jobManager.cleanupOldJobs();
          this.server.broadcastNewJob(freshJob);
          logger.info(`📡 Fresh job sent to miners with unchanged template (job: ${freshJobId}, height: ${retryTemplate.index})`);
          logger.info(`Continuing normal mining operation...`);
        }
      }

    } catch (error) {
      logger.error(`Error handling block submission: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    } finally {
      if (blockHeight !== null && this.server.processingHeights) {
        this.server.processingHeights.delete(blockHeight);
        logger.debug(`Height ${blockHeight} removed from processing set`);
      }
    }
  }
}

module.exports = BlockCoordinator;


