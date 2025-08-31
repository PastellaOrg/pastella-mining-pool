/**
 * Difficulty Manager for automatic difficulty adjustment per client
 * Adjusts difficulty based on share submission rate to maintain optimal mining
 */

const logger = require('../utils/logger');

class DifficultyManager {
  constructor(config) {
    this.config = config;

    // Difficulty adjustment settings
    this.targetShareInterval = 10; // Target: 1 share every 10 seconds
    this.adjustmentWindow = 60; // Adjust based on last 60 seconds
    this.maxDifficultyIncrease = 2.0; // Max 2x increase per adjustment
    this.maxDifficultyDecrease = 0.5; // Max 50% decrease per adjustment
    this.minDifficulty = 1; // Minimum difficulty
    this.maxDifficulty = 1000000; // Maximum difficulty

    // Client tracking
    this.clients = new Map(); // clientId -> client data

    logger.info('Difficulty Manager initialized');
    logger.debug(`Target share interval: ${this.targetShareInterval}s`);
    logger.debug(`Adjustment window: ${this.adjustmentWindow}s`);
  }

  /**
   * Register a new client
   */
  registerClient(clientId) {
    const startingDifficulty = this.config.get('mining.startingDifficulty') || 100;

    this.clients.set(clientId, {
      difficulty: startingDifficulty,
      shares: [],
      lastAdjustment: Date.now(),
      totalShares: 0,
      validShares: 0,
      invalidShares: 0,
      registeredAt: Date.now()
    });

    logger.debug(`Client ${clientId} registered with starting difficulty: ${startingDifficulty}`);
    return startingDifficulty;
  }

  /**
   * Remove a client
   */
  unregisterClient(clientId) {
    if (this.clients.has(clientId)) {
      this.clients.delete(clientId);
      logger.debug(`Client ${clientId} unregistered`);
    }
  }

  /**
   * Record a share submission
   */
  recordShare(clientId, isValid) {
    const client = this.clients.get(clientId);
    if (!client) {
      logger.warn(`Share recorded for unknown client: ${clientId}`);
      return;
    }

    const now = Date.now();

    // Add share to history
    client.shares.push({
      timestamp: now,
      valid: isValid
    });

    // Update counters
    client.totalShares++;
    if (isValid) {
      client.validShares++;
    } else {
      client.invalidShares++;
    }

    // Clean old shares outside adjustment window
    const windowStart = now - (this.adjustmentWindow * 1000);
    client.shares = client.shares.filter(share => share.timestamp >= windowStart);

    // Check if we should adjust difficulty
    this.checkDifficultyAdjustment(clientId);
  }

  /**
   * Get current difficulty for a client
   */
  getClientDifficulty(clientId) {
    const client = this.clients.get(clientId);
    return client ? client.difficulty : this.config.get('mining.startingDifficulty') || 100;
  }

  /**
   * Check if difficulty needs adjustment for a client
   */
  checkDifficultyAdjustment(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const now = Date.now();
    const timeSinceLastAdjustment = now - client.lastAdjustment;

    // Only adjust every 30 seconds minimum
    if (timeSinceLastAdjustment < 30000) return;

    // Need at least 5 shares in the window to make adjustment
    if (client.shares.length < 5) return;

    const windowStart = now - (this.adjustmentWindow * 1000);
    const recentShares = client.shares.filter(share =>
      share.timestamp >= windowStart && share.valid
    );

    if (recentShares.length < 3) return; // Need at least 3 valid shares

    // Calculate actual share interval
    const timeSpan = now - recentShares[0].timestamp;
    const actualInterval = timeSpan / (recentShares.length - 1) / 1000; // seconds

    const oldDifficulty = client.difficulty;
    let newDifficulty = oldDifficulty;

    // Adjust difficulty based on share rate
    if (actualInterval < this.targetShareInterval * 0.5) {
      // Shares coming too fast - increase difficulty
      const multiplier = Math.min(this.maxDifficultyIncrease, this.targetShareInterval / actualInterval);
      newDifficulty = Math.round(oldDifficulty * multiplier);
      logger.debug(`Client ${clientId}: Shares too fast (${actualInterval.toFixed(1)}s), increasing difficulty`);

    } else if (actualInterval > this.targetShareInterval * 2) {
      // Shares coming too slow - decrease difficulty
      const multiplier = Math.max(this.maxDifficultyDecrease, this.targetShareInterval / actualInterval);
      newDifficulty = Math.round(oldDifficulty * multiplier);
      logger.debug(`Client ${clientId}: Shares too slow (${actualInterval.toFixed(1)}s), decreasing difficulty`);
    }

    // Apply limits
    newDifficulty = Math.max(this.minDifficulty, Math.min(this.maxDifficulty, newDifficulty));

    // Only adjust if change is significant (at least 10%)
    const changePercent = Math.abs(newDifficulty - oldDifficulty) / oldDifficulty;
    if (changePercent >= 0.1) {
      client.difficulty = newDifficulty;
      client.lastAdjustment = now;

      logger.info(`Client ${clientId} difficulty adjusted: ${oldDifficulty} → ${newDifficulty} ` +
                 `(interval: ${actualInterval.toFixed(1)}s, target: ${this.targetShareInterval}s)`);

      return {
        adjusted: true,
        oldDifficulty,
        newDifficulty,
        actualInterval: actualInterval.toFixed(1)
      };
    }

    return { adjusted: false };
  }

  /**
   * Get client statistics
   */
  getClientStats(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return null;

    const now = Date.now();
    const windowStart = now - (this.adjustmentWindow * 1000);
    const recentShares = client.shares.filter(share => share.timestamp >= windowStart);
    const recentValidShares = recentShares.filter(share => share.valid);

    let shareRate = 0;
    if (recentValidShares.length >= 2) {
      const timeSpan = now - recentValidShares[0].timestamp;
      shareRate = (recentValidShares.length - 1) / (timeSpan / 1000);
    }

    return {
      difficulty: client.difficulty,
      totalShares: client.totalShares,
      validShares: client.validShares,
      invalidShares: client.invalidShares,
      recentShares: recentShares.length,
      recentValidShares: recentValidShares.length,
      shareRate: shareRate.toFixed(3),
      registeredAt: client.registeredAt,
      lastAdjustment: client.lastAdjustment
    };
  }

  /**
   * Get overall statistics
   */
  getOverallStats() {
    const totalClients = this.clients.size;
    let totalShares = 0;
    let totalValidShares = 0;
    let totalInvalidShares = 0;
    let avgDifficulty = 0;

    for (const client of this.clients.values()) {
      totalShares += client.totalShares;
      totalValidShares += client.validShares;
      totalInvalidShares += client.invalidShares;
      avgDifficulty += client.difficulty;
    }

    if (totalClients > 0) {
      avgDifficulty = avgDifficulty / totalClients;
    }

    return {
      totalClients,
      totalShares,
      totalValidShares,
      totalInvalidShares,
      avgDifficulty: avgDifficulty.toFixed(2),
      validShareRate: totalShares > 0 ? (totalValidShares / totalShares * 100).toFixed(1) : '0.0'
    };
  }
}

module.exports = DifficultyManager;
