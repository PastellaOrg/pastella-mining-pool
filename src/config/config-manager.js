const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class ConfigManager {
  constructor() {
    this.configPath = path.join(__dirname, '../../config/pool.json');
    this.config = this.loadDefaultConfig();
    this.loadConfig();
  }

  loadDefaultConfig() {
    return {
      // Pool settings
      pool: {
        name: 'Pastella Mining Pool',
        description: 'Mining pool for Pastella cryptocurrency using Velora algorithm',
        version: '1.0.0',
        fee: 0.01, // 1% pool fee
        minPayout: 0.001, // Minimum payout in PSTL
        payoutInterval: 3600000, // Payout every hour (in milliseconds)
      },

      // HTTP API settings
      http: {
        port: 3000,
        host: '0.0.0.0',
        cors: true,
      },

      // Stratum server settings
      stratum: {
        port: 3333,
        host: '0.0.0.0',
        maxConnections: 1000,
        timeout: 30000,
      },

      // Daemon connection settings
      daemon: {
        url: 'http://localhost:22000',
        apiKey: '',
        username: '',
        password: '',
        timeout: 30000,
        retryInterval: 5000,
      },

      // Mining settings
      mining: {
        algorithm: 'velora',
        startingDifficulty: 1,
        shareTimeout: 300000, // 5 minutes
        maxShareAge: 3600000, // 1 hour
      },

      // Database settings
      database: {
        type: 'sqlite',
        path: './data/pool.db',
        backupInterval: 86400000, // 24 hours
      },

      // Logging settings
      logging: {
        level: 'info',
        file: './logs/pool.log',
        maxSize: '10m',
        maxFiles: 5,
      },

      // Security settings
      security: {
        rateLimit: {
          windowMs: 15 * 60 * 1000, // 15 minutes
          max: 100, // limit each IP to 100 requests per windowMs
        },
        allowedOrigins: ['*'],
      },

      // Payout settings
      payout: {
        enabled: true,
        minConfirmations: 6,
        batchSize: 50,
        gasPrice: '20000000000', // 20 Gwei
      },
    };
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        const userConfig = JSON.parse(configData);
        this.mergeConfig(this.config, userConfig);
        logger.info(`Configuration loaded from: ${this.configPath}`);
      } else {
        this.saveConfig();
        logger.info(`Default configuration created at: ${this.configPath}`);
      }
    } catch (error) {
      logger.error(`Failed to load configuration: ${error.message}`);
      logger.info('Using default configuration');
    }
  }

  mergeConfig(defaultConfig, userConfig) {
    for (const key in userConfig) {
      if (userConfig.hasOwnProperty(key)) {
        if (typeof userConfig[key] === 'object' && userConfig[key] !== null && !Array.isArray(userConfig[key])) {
          if (defaultConfig[key] && typeof defaultConfig[key] === 'object') {
            this.mergeConfig(defaultConfig[key], userConfig[key]);
          } else {
            defaultConfig[key] = userConfig[key];
          }
        } else {
          defaultConfig[key] = userConfig[key];
        }
      }
    }
  }

  saveConfig() {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      console.log('Configuration saved to:', this.configPath);
    } catch (error) {
      console.error('Failed to save configuration:', error);
    }
  }

  get(key, defaultValue = null) {
    const keys = key.split('.');
    let value = this.config;

    for (const k of keys) {
      if (value && typeof value === 'object' && value.hasOwnProperty(k)) {
        value = value[k];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  set(key, value) {
    const keys = key.split('.');
    let config = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!config[k] || typeof config[k] !== 'object') {
        config[k] = {};
      }
      config = config[k];
    }

    config[keys[keys.length - 1]] = value;
  }

  update(newConfig) {
    this.mergeConfig(this.config, newConfig);
    this.saveConfig();
  }

  getPoolInfo() {
    return {
      name: this.get('pool.name'),
      version: this.get('pool.version'),
      algorithm: this.get('mining.algorithm'),
      fee: this.get('pool.fee'),
      minPayout: this.get('pool.minPayout'),
    };
  }

  getDaemonConfig() {
    return {
      url: this.get('daemon.url'),
      apiKey: this.get('daemon.apiKey'),
      username: this.get('daemon.username'),
      password: this.get('daemon.password'),
      timeout: this.get('daemon.timeout'),
    };
  }

  getMiningConfig() {
    return {
      algorithm: this.get('mining.algorithm'),
      startingDifficulty: this.get('mining.startingDifficulty'),
      shareTimeout: this.get('mining.shareTimeout'),
    };
  }

  // Validate configuration
  validate() {
    const errors = [];

    // Check required fields
    if (!this.get('pool.name')) {
      errors.push('Pool name is required');
    }

    if (!this.get('daemon.url')) {
      errors.push('Daemon URL is required');
    }

    if (this.get('pool.fee') < 0 || this.get('pool.fee') > 1) {
      errors.push('Pool fee must be between 0 and 1');
    }

    if (this.get('mining.startingDifficulty') <= 0) {
      errors.push('Starting difficulty must be greater than 0');
    }

    if (this.get('http.port') < 1 || this.get('http.port') > 65535) {
      errors.push('HTTP port must be between 1 and 65535');
    }

    if (this.get('stratum.port') < 1 || this.get('stratum.port') > 65535) {
      errors.push('Stratum port must be between 1 and 65535');
    }

    return {
      valid: errors.length === 0,
      errors: errors,
    };
  }

  // Get configuration for specific component
  getComponentConfig(component) {
    switch (component) {
      case 'pool':
        return this.get('pool');
      case 'http':
        return this.get('http');
      case 'stratum':
        return this.get('stratum');
      case 'daemon':
        return this.get('daemon');
      case 'mining':
        return this.get('mining');
      case 'database':
        return this.get('database');
      case 'logging':
        return this.get('logging');
      case 'security':
        return this.get('security');
      case 'payout':
        return this.get('payout');
      default:
        return null;
    }
  }
}

module.exports = ConfigManager;

