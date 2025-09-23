const axios = require('axios');
const logger = require('../utils/logger.js');

class BlockTemplateManager {
  constructor(config) {
    this.config = config;
    this.currentTemplate = null;
    this.lastUpdate = 0;
    this.updateInterval = this.config.get('mining.templateUpdateInterval') || 30000; // Default 30 seconds
    this.isUpdating = false;
    this.newTemplateCallback = null; // Callback for when new templates are available

    // Start template updates
    this.startTemplateUpdates();
  }

  /**
   * Set callback for new template notifications
   */
  setNewTemplateCallback(callback) {
    this.newTemplateCallback = callback;
  }

  /**
   * Start automatic template updates
   */
  startTemplateUpdates() {
    setInterval(() => {
      this.updateTemplate();
    }, this.updateInterval);

    // Initial update
    this.updateTemplate();
  }

  /**
   * Update the current block template from the daemon
   */
  async updateTemplate() {
    if (this.isUpdating) {
      return;
    }

    this.isUpdating = true;

    try {
      const daemonConfig = this.config.getDaemonConfig();
      logger.debug(`Attempting to update template from daemon: ${daemonConfig.url}`);

      const template = await this.getRealTemplateFromDaemon(daemonConfig);

      if (template) {
        const isNewHeight = !this.currentTemplate || this.currentTemplate.index !== template.index;
        this.currentTemplate = template;
        this.lastUpdate = Date.now();
        
        if (isNewHeight) {
          logger.info(`Template updated successfully - Height: ${template.index}, Difficulty: ${template.difficulty}`);
          
          // Notify callback immediately when new template is available
          if (this.newTemplateCallback) {
            try {
              this.newTemplateCallback(template);
            } catch (error) {
              logger.error(`Error in new template callback: ${error.message}`);
            }
          }
        } else {
          logger.debug(`Template refreshed (same height ${template.index})`);
        }
      }
    } catch (error) {
      logger.error(`Failed to update template: ${error.message}`);
      logger.debug(`Template update error details: ${error.stack || 'No stack trace'}`);
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Get real block template from the daemon
   */
  async getRealTemplateFromDaemon(daemonConfig) {
    try {
      const { url, apiKey, username, password } = daemonConfig;

      if (!url) {
        throw new Error('Daemon URL not configured');
      }

      logger.debug(`Connecting to daemon at: ${url}`);

      // Build request URL
      const templateUrl = `${url}/api/mining/template`;
      logger.debug(`Requesting template from: ${templateUrl}`);

      // Prepare headers
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Pastella-Mining-Pool/1.0.0',
      };

      // Add authentication if provided
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
        logger.debug('Using API key authentication');
      } else if (username && password) {
        const auth = Buffer.from(`${username}:${password}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
        logger.debug('Using basic authentication');
      } else {
        logger.debug('No authentication provided');
      }

      logger.debug(`Request headers: ${JSON.stringify(headers)}`);

      // Make request to daemon
      const response = await axios.get(templateUrl, {
        headers,
        timeout: daemonConfig.timeout || 30000,
        params: {
          address: this.config.get('pool.feeAddress') || 'pool-fee-address',
        },
      });

      logger.debug(`Daemon response status: ${response.status}`);

      if (response.status === 200 && response.data) {
        const template = response.data;
        logger.debug(`Template received: ${JSON.stringify(template).substring(0, 200)}...`);

        // Validate template structure
        if (this.validateTemplate(template)) {
          logger.debug('Template validation passed');
          return this.formatTemplate(template);
        } else {
          logger.error('Template validation failed');
          throw new Error('Invalid template structure received from daemon');
        }
      } else {
        throw new Error(`Daemon returned status ${response.status}`);
      }
    } catch (error) {
      logger.error(`Daemon request failed: ${error.message}`);

      if (error.code === 'ECONNREFUSED') {
        logger.error('Connection refused - daemon may not be running on the specified port');
        throw new Error('Cannot connect to daemon - is it running?');
      } else if (error.code === 'ETIMEDOUT') {
        logger.error('Request timed out - daemon may be overloaded or network issue');
        throw new Error('Daemon request timed out');
      } else if (error.code === 'ENOTFOUND') {
        logger.error('Host not found - check daemon URL');
        throw new Error('Daemon host not found - check URL configuration');
      } else if (error.response) {
        logger.error(
          'BlockTemplate',
          `Daemon HTTP error: ${error.response.status} - ${error.response.data?.error || 'Unknown error'}`
        );
        throw new Error(`Daemon error: ${error.response.status} - ${error.response.data?.error || 'Unknown error'}`);
      } else {
        logger.error(`Network error: ${error.message}`);
        throw new Error(`Daemon request failed: ${error.message}`);
      }
    }
  }

  /**
   * Validate template structure
   */
  validateTemplate(template) {
    const required = ['index', 'difficulty', 'previousHash', 'timestamp', 'merkleRoot', 'transactions'];

    for (const field of required) {
      if (!template.hasOwnProperty(field)) {
        logger.error(`Template missing required field: ${field}`);
        return false;
      }
    }

    if (!Array.isArray(template.transactions) || template.transactions.length === 0) {
      logger.error('Template must have at least one transaction (coinbase)');
      return false;
    }

    // Check for coinbase transaction
    const coinbase = template.transactions.find(tx => tx.isCoinbase);
    if (!coinbase) {
      logger.error('Template must have a coinbase transaction');
      return false;
    }

    return true;
  }

  /**
   * Format template for mining pool use
   */
  formatTemplate(template) {
    return {
      index: template.index,
      difficulty: template.difficulty,
      previousHash: template.previousHash,
      timestamp: template.timestamp,
      merkleRoot: template.merkleRoot,
      transactions: template.transactions,
      coinbase: template.coinbase,
      diagnostics: template.diagnostics || {},

      // Pool-specific fields
      poolDifficulty: this.calculatePoolDifficulty(template.difficulty),
      shareMultiplier: this.calculateShareMultiplier(template.difficulty),
      expiresAt: template.timestamp + (this.config.get('mining.shareTimeout') || 300000),

      // Template metadata
      receivedAt: Date.now(),
      version: '1.0.0',
    };
  }

  /**
   * Calculate pool difficulty (automatic adjustment based on share rate)
   * Uses configured starting difficulty but caps it to avoid excessive block finding
   */
  calculatePoolDifficulty(blockDifficulty) {
    // Use configured starting difficulty instead of hardcoded 1
    const startingDifficulty = this.config.get('mining.startingDifficulty') || 50000;
    
    // For high network difficulty, allow much higher pool difficulty to prevent WAIT spam
    // The key insight: pool difficulty should be high enough to prevent every share from being a block solution
    // At minimum, pool difficulty should be 20% of network difficulty to keep block solution chance under 20%
    const minPoolDifficulty = Math.max(blockDifficulty * 0.2, 1000); // 20% of network difficulty, minimum 1000
    
    // Use the higher of configured starting difficulty or calculated minimum
    // This prevents the WAIT response issue when miners have high hashrates
    const adjustedDifficulty = Math.max(startingDifficulty, minPoolDifficulty);
    
    // Cap at reasonable maximum to avoid making shares too hard to find
    const maxPoolDifficulty = blockDifficulty * 0.5; // Max 50% of network difficulty  
    
    // TODO: Implement automatic difficulty adjustment based on share submission rate
    return Math.min(adjustedDifficulty, maxPoolDifficulty);
  }

  /**
   * Calculate share multiplier for reward calculations
   */
  calculateShareMultiplier(blockDifficulty) {
    const poolDifficulty = this.calculatePoolDifficulty(blockDifficulty);
    return blockDifficulty / poolDifficulty;
  }

  /**
   * Get current block template
   */
  getCurrentTemplate() {
    if (!this.currentTemplate) {
      return null;
    }

    // Check if template is expired
    if (Date.now() > this.currentTemplate.expiresAt) {
      logger.warn('Current template has expired, updating...');
      this.updateTemplate();
      return null;
    }

    return this.currentTemplate;
  }

  /**
   * Get template info for API responses
   */
  getTemplateInfo() {
    const template = this.getCurrentTemplate();

    if (!template) {
      return {
        available: false,
        message: 'No template available',
      };
    }

    return {
      available: true,
      index: template.index,
      difficulty: template.difficulty,
      poolDifficulty: template.poolDifficulty,
      previousHash: template.previousHash,
      timestamp: template.timestamp,
      merkleRoot: template.merkleRoot,
      transactionCount: template.transactions.length,
      coinbase: template.coinbase,
      expiresAt: template.expiresAt,
      lastUpdate: this.lastUpdate,
      age: Date.now() - this.lastUpdate,
    };
  }

  /**
   * Force template update
   */
  async forceUpdate() {
    logger.info('Forcing template update...');
    await this.updateTemplate();
  }

  /**
   * Get template statistics
   */
  getStats() {
    return {
      currentTemplate: this.currentTemplate
        ? {
            index: this.currentTemplate.index,
            difficulty: this.currentTemplate.difficulty,
            age: Date.now() - this.lastUpdate,
          }
        : null,
      lastUpdate: this.lastUpdate,
      updateInterval: this.updateInterval,
      isUpdating: this.isUpdating,
      uptime: Date.now() - this.lastUpdate,
    };
  }
}

module.exports = BlockTemplateManager;
