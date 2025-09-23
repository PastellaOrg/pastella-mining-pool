const logger = require('../../utils/logger.js');

class JobManager {
  constructor(server) {
    this.server = server;
    this.currentHeight = null; // Track current height to avoid duplicate job updates
  }

  createInitialJob() {
    try {
      if (!this.server.blockTemplateManager) {
        setTimeout(() => this.createInitialJob(), 2000);
        return;
      }

      const template = this.server.blockTemplateManager.getCurrentTemplate();
      if (!template) {
        setTimeout(() => this.createInitialJob(), 2000);
        return;
      }

      const jobId = this.server.generateJobId();
      // 🎯 CRITICAL FIX: Deep copy template to preserve original timestamp and parameters
      const originalTemplate = JSON.parse(JSON.stringify(template));
      const job = {
        id: jobId,
        template: template, // Keep reference for compatibility
        originalTemplate: originalTemplate, // 🎯 NEW: Preserve original template for exact mining conditions
        transactions: template.transactions || [],
        previousHash: template.previousHash || 'unknown',
        merkleRoot: template.merkleRoot || 'unknown',
        version: 1,
        nbits: this.server.difficultyToBits(template.difficulty || 1),
        ntime: Math.floor((template.timestamp || Date.now()) / 1000),
        cleanJobs: true,
        expiresAt: Date.now() + 300000,
        createdAt: Date.now(), // 🎯 Track when job was created for debugging
      };

      this.server.jobs.set(jobId, job);
      this.currentHeight = template.index; // Track the initial height
      logger.info(`Initial job created for height ${template.index} (diff: ${template.difficulty})`);
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
    } catch (error) {
      logger.error(`Error starting job updates: ${error.message}`);
      logger.debug(`Error stack: ${error.stack}`);
    }
  }

  updateJobs(forceUpdate = false) {
    try {
      if (!this.server.blockTemplateManager) {
        return;
      }

      const template = this.server.blockTemplateManager.getCurrentTemplate();
      if (!template) {
        return;
      }

      // Only create new job if height has changed, unless it's a forced update
      if (!forceUpdate && this.currentHeight !== null && this.currentHeight === template.index) {
        logger.debug(`Job update skipped - same height ${template.index}`);
        return;
      }

      // Log when forcing update for same height (after block submission)
      if (forceUpdate && this.currentHeight !== null && this.currentHeight === template.index) {
        logger.info(`Forced job update for same height ${template.index} (after block submission)`);
      }

      const jobId = this.server.generateJobId();
      // 🎯 CRITICAL FIX: Deep copy template to preserve original timestamp and parameters
      const originalTemplate = JSON.parse(JSON.stringify(template));
      const job = {
        id: jobId,
        template: template, // Keep reference for compatibility
        originalTemplate: originalTemplate, // 🎯 NEW: Preserve original template for exact mining conditions
        transactions: template.transactions || [],
        previousHash: template.previousHash || 'unknown',
        merkleRoot: template.merkleRoot || 'unknown',
        version: 1,
        nbits: this.server.difficultyToBits(template.difficulty || 1),
        ntime: Math.floor((template.timestamp || Date.now()) / 1000),
        cleanJobs: true,
        expiresAt: template.expiresAt || Date.now() + 300000,
        createdAt: Date.now(), // 🎯 Track when job was created for debugging
      };

      this.server.jobs.set(jobId, job);
      this.server.cleanupOldJobs();
      this.server.broadcastNewJob(job);
      
      this.currentHeight = template.index; // Update tracked height
      logger.info(`Updated mining job for height ${template.index} (diff: ${template.difficulty})`);
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
            // 🎯 CRITICAL FIX: Use original template timestamp for mining consistency
            const originalTemplate = job.originalTemplate || job.template;
            this.server.sendToClient(clientId, {
              id: null,
              method: 'job',
              params: {
                job_id: job.id,
                height: originalTemplate.index || 0,
                timestamp: originalTemplate.timestamp || Date.now(),
                previous_hash: originalTemplate.previousHash || 'unknown',
                merkle_root: originalTemplate.merkleRoot || 'unknown',
                difficulty: originalTemplate.difficulty || 1,
                pool_difficulty: client.difficulty || 1,
                algo: 'velora'
              },
            });

            sentCount++;
          }
        } catch (error) {
          logger.error(`Error sending job to client ${clientId}: ${error.message}`);
        }
      }
      
      if (sentCount > 0) {
        logger.info(`New job sent to ${sentCount} miners (height: ${job.template.index}, diff: ${job.template.difficulty})`);
      }
    } catch (error) {
      logger.error(`Error in broadcastNewJob: ${error.message}`);
      logger.debug(`Error stack: ${error.stack}`);
    }
  }
}

module.exports = JobManager;




