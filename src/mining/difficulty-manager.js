/**
 * Difficulty Manager for automatic difficulty adjustment per client
 * Adjusts difficulty based on share submission rate to maintain optimal mining
 */

const logger = require('../utils/logger');

class DifficultyManager {
  constructor(config) {
    this.config = config;

    // Difficulty adjustment settings
    this.targetShareInterval = 6; // Target: 1 share every 6 seconds (10 per minute)
    this.adjustmentWindow = 120; // Adjust based on last 2 minutes for more stability
    this.maxDifficultyIncrease = 1.2; // Max 20% increase per adjustment
    this.maxDifficultyDecrease = 0.8; // Max 20% decrease per adjustment
    this.minDifficulty = 1000; // Minimum difficulty
    this.maxDifficulty = Number.MAX_SAFE_INTEGER; // No maximum difficulty - be fair to all miners

    // Client tracking
    this.clients = new Map(); // clientId -> client data

    logger.info('Difficulty Manager initialized');
    logger.debug(`Target share interval: ${this.targetShareInterval}s`);
    logger.debug(`Adjustment window: ${this.adjustmentWindow}s`);
  }

  /**
   * Register a new client
   */
  registerClient(clientId, networkDifficulty = null) {
    let startingDifficulty = this.config.get('mining.startingDifficulty') || 100;
    
    // Use configured starting difficulty to test adjustment system

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

    // Don't auto-adjust here - let the submit handler handle it
    // this.checkDifficultyAdjustment(clientId);
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

    // Only adjust every 60 seconds minimum for stability
    if (timeSinceLastAdjustment < 60000) {
      logger.debug(`Client ${clientId}: Too soon for adjustment (${(timeSinceLastAdjustment/1000).toFixed(1)}s < 60s)`);
      return;
    }

    // Need at least 5 shares in the window to make adjustment
    if (client.shares.length < 5) {
      logger.debug(`Client ${clientId}: Not enough shares (${client.shares.length} < 5)`);
      return;
    }

    const windowStart = now - (this.adjustmentWindow * 1000);
    const recentShares = client.shares.filter(share =>
      share.timestamp >= windowStart && share.valid
    );

    if (recentShares.length < 3) {
      logger.debug(`Client ${clientId}: Not enough valid shares in window (${recentShares.length} < 3)`);
      return;
    }

    // Calculate actual share interval
    const timeSpan = now - recentShares[0].timestamp;
    const actualInterval = timeSpan / (recentShares.length - 1) / 1000; // seconds

    logger.debug(`Client ${clientId}: Checking adjustment - interval: ${actualInterval.toFixed(2)}s, target: ${this.targetShareInterval}s, shares: ${recentShares.length}`);

    const oldDifficulty = client.difficulty;
    let newDifficulty = oldDifficulty;

    // Adjust difficulty based on share rate (more conservative)
    if (actualInterval < this.targetShareInterval * 0.7) {
      // Shares coming too fast - increase difficulty by max 20%
      newDifficulty = Math.round(oldDifficulty * this.maxDifficultyIncrease);
      logger.debug(`Client ${clientId}: Shares too fast (${actualInterval.toFixed(1)}s), increasing difficulty`);

    } else if (actualInterval > this.targetShareInterval * 1.5) {
      // Shares coming too slow - decrease difficulty by max 20%
      newDifficulty = Math.round(oldDifficulty * this.maxDifficultyDecrease);
      logger.debug(`Client ${clientId}: Shares too slow (${actualInterval.toFixed(1)}s), decreasing difficulty`);
    }

    // Apply minimum limit only (no maximum for fairness)
    newDifficulty = Math.max(this.minDifficulty, newDifficulty);

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
