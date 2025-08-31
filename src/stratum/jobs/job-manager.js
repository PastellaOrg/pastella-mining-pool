const logger = require('../../utils/logger.js');

class JobManager {
  constructor(server) {
    this.server = server;
  }

  createInitialJob() {
    try {
      logger.info('Attempting to create initial job...');

      if (!this.server.blockTemplateManager) {
        logger.warn('Block template manager not available for initial job creation, will retry when ready');
        setTimeout(() => this.createInitialJob(), 2000);
        return;
      }

      const template = this.server.blockTemplateManager.getCurrentTemplate();
      if (!template) {
        logger.warn('No block template available for initial job creation, will retry when template is ready');
        setTimeout(() => this.createInitialJob(), 2000);
        return;
      }

      logger.info(`Got template: index=${template.index}, difficulty=${template.difficulty}, timestamp=${template.timestamp}`);

      const jobId = this.server.generateJobId();
      const job = {
        id: jobId,
        template: template,
        transactions: template.transactions || [],
        previousHash: template.previousHash || 'unknown',
        merkleRoot: template.merkleRoot || 'unknown',
        version: 1,
        nbits: this.server.difficultyToBits(template.difficulty || 1),
        ntime: Math.floor((template.timestamp || Date.now()) / 1000),
        cleanJobs: true,
        expiresAt: Date.now() + 300000,
      };

      this.server.jobs.set(jobId, job);
      logger.info(`🏁 Initial job created for height ${template.index} (diff: ${template.difficulty})`);
      logger.debug(`Job details: prevHash=${job.previousHash}, merkleRoot=${job.merkleRoot}`);
      logger.debug(`Job stored in map. Total jobs now: ${this.server.jobs.size}`);
      logger.debug(`Job expires at: ${new Date(job.expiresAt).toISOString()}`);
    } catch (error) {
      logger.error(`Error creating initial job: ${error.message}`);
      logger.debug(`Error stack: ${error.stack}`);
      setTimeout(() => this.createInitialJob(), 5000);
    }
  }

  startJobUpdates() {
    try {
      setInterval(() => {
        try {
          this.updateJobs();
        } catch (error) {
          logger.error(`Error in job update interval: ${error.message}`);
          logger.error(`Error stack: ${error.stack}`);
        }
      }, 30000);
      logger.info('Job updates started (every 30 seconds)');
    } catch (error) {
      logger.error(`Error starting job updates: ${error.message}`);
      logger.debug(`Error stack: ${error.stack}`);
    }
  }

  updateJobs() {
    try {
      if (!this.server.blockTemplateManager) {
        logger.warn('Block template manager not available for job update');
        return;
      }

      const template = this.server.blockTemplateManager.getCurrentTemplate();
      if (!template) {
        logger.warn('No block template available for job update');
        return;
      }

      const jobId = this.server.generateJobId();
      const job = {
        id: jobId,
        template: template,
        transactions: template.transactions || [],
        previousHash: template.previousHash || 'unknown',
        merkleRoot: template.merkleRoot || 'unknown',
        version: 1,
        nbits: this.server.difficultyToBits(template.difficulty || 1),
        ntime: Math.floor((template.timestamp || Date.now()) / 1000),
        cleanJobs: true,
        expiresAt: template.expiresAt || Date.now() + 300000,
      };

      this.server.jobs.set(jobId, job);
      this.server.cleanupOldJobs();
      this.server.broadcastNewJob(job);

      logger.debug(`New job created: ${jobId}, height: ${template.index}`);
      logger.info(`📝 Updated mining job for height ${template.index} (diff: ${template.difficulty})`);
    } catch (error) {
      logger.error(`Error updating jobs: ${error.message}`);
      logger.debug(`Error stack: ${error.stack}`);
    }
  }

  cleanupOldJobs() {
    try {
      const now = Date.now();
      let cleanedCount = 0;
      for (const [jobId, job] of this.server.jobs.entries()) {
        try {
          if (job && job.expiresAt && now > job.expiresAt) {
            this.server.jobs.delete(jobId);
            cleanedCount++;
          }
        } catch (error) {
          logger.error(`Error cleaning up job ${jobId}: ${error.message}`);
        }
      }
      if (cleanedCount > 0) {
        logger.debug(`Cleaned up ${cleanedCount} expired jobs`);
      }
    } catch (error) {
      logger.error(`Error in cleanupOldJobs: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  broadcastNewJob(job) {
    try {
      if (!job || !job.template) {
        logger.error('Invalid job for broadcast');
        return;
      }

      let sentCount = 0;
      for (const [clientId, client] of this.server.clients.entries()) {
        try {
          if (client && client.subscribed && client.authorized) {
            this.server.sendToClient(clientId, {
              id: null,
              method: 'job',
              params: {
                job_id: job.id,
                height: job.template.index || 0,
                timestamp: job.template.timestamp || Date.now(),
                previous_hash: job.template.previousHash || 'unknown',
                merkle_root: job.template.merkleRoot || 'unknown',
                difficulty: job.template.difficulty || 1,
                pool_difficulty: client.difficulty || 1,
                algo: 'velora'
              },
            });

            sentCount++;
            logger.debug(`Sent Velora job notification to ${clientId}: ${job.id}`);
          }
        } catch (error) {
          logger.error(`Error sending job to client ${clientId}: ${error.message}`);
        }
      }
      
      if (sentCount > 0) {
        logger.info(`📡 New job sent to ${sentCount} miners (height: ${job.template.index}, diff: ${job.template.difficulty})`);
      }
    } catch (error) {
      logger.error(`Error in broadcastNewJob: ${error.message}`);
      logger.debug(`Error stack: ${error.stack}`);
    }
  }
}

module.exports = JobManager;




