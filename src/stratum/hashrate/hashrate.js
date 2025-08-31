const logger = require('../../utils/logger.js');

class HashrateService {
  constructor(server) {
    this.server = server;
  }

  calculateMinerHashrate(clientId) {
    try {
      const tracker = this.server.hashrateTracker.get(clientId);
      if (!tracker || tracker.shares.length === 0) {
        return 0;
      }

      const now = Date.now();
      const windowMs = 60000; // 1 minute window
      const recentShares = tracker.shares.filter(share => (now - share.timestamp) < windowMs);

      if (recentShares.length === 0) {
        return 0;
      }

      const timeSpan = (now - recentShares[0].timestamp) / 1000;
      const sharesPerSecond = recentShares.length / timeSpan;

      const template = this.server.blockTemplateManager ? this.server.blockTemplateManager.getCurrentTemplate() : null;
      const networkDifficulty = template ? template.difficulty : 1;

      const relativeHashrate = sharesPerSecond * 1000000; // 1 share/s = 1 MH/s baseline

      if (recentShares.length > 0) {
        logger.debug(`Hashrate calculation for ${clientId}: ${recentShares.length} shares in ${timeSpan.toFixed(2)}s = ${sharesPerSecond.toFixed(4)} shares/s, network difficulty: ${networkDifficulty}, relative hashrate: ${(relativeHashrate / 1000000).toFixed(2)} MH/s`);
      }

      return Math.floor(relativeHashrate);
    } catch (error) {
      logger.error(`Error calculating hashrate for miner ${clientId}: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      return 0;
    }
  }

  calculateTotalHashrate() {
    let totalHashrate = 0;
    try {
      for (const [clientId, client] of this.server.clients.entries()) {
        if (client && client.authorized) {
          const hashrate = this.calculateMinerHashrate(clientId);
          totalHashrate += hashrate;
        }
      }
    } catch (error) {
      logger.error(`Error calculating total hashrate: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
    return totalHashrate;
  }

  recordShareForHashrate(clientId, difficulty) {
    try {
      if (!this.server.hashrateTracker.has(clientId)) {
        this.server.hashrateTracker.set(clientId, { shares: [], lastUpdate: Date.now() });
      }

      const tracker = this.server.hashrateTracker.get(clientId);
      const now = Date.now();

      tracker.shares.push({
        timestamp: now,
        difficulty: difficulty
      });

      if (tracker.shares.length > 100) {
        tracker.shares = tracker.shares.slice(-100);
      }

      tracker.lastUpdate = now;

      const client = this.server.clients.get(clientId);
      if (client) {
        const template = this.server.blockTemplateManager ? this.server.blockTemplateManager.getCurrentTemplate() : null;
        const networkDifficulty = template ? template.difficulty : 1;
        logger.debug(`Share recorded for ${clientId}: pool difficulty: ${difficulty}, network difficulty: ${networkDifficulty}`);

        client.hashrate = this.calculateMinerHashrate(clientId);
      }
    } catch (error) {
      logger.error(`Error recording share for hashrate calculation: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  async updateMinerHashratesInDatabase() {
    if (!this.server.databaseManager) {
      return;
    }

    try {
      for (const [clientId, client] of this.server.clients.entries()) {
        if (client && client.authorized) {
          const hashrate = this.calculateMinerHashrate(clientId);
          await this.server.databaseManager.updateMinerHashrate(clientId, hashrate);
        }
      }
    } catch (error) {
      logger.error(`Error updating miner hashrates in database: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }
}

module.exports = HashrateService;




