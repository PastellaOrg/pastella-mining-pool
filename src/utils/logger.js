const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Read config directly to avoid circular dependency
function getLogLevelFromConfig() {
  try {
    const configPath = path.join(__dirname, '../../config/pool.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return config.logging?.level || 'info';
    }
  } catch (error) {
    console.error('Failed to read log level from config:', error.message);
  }
  return 'info'; // Default fallback
}

class Logger {
  constructor() {
    this.setupLogger();
  }

  setupLogger() {
    // Create logs directory if it doesn't exist
    const logsDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Define log format with timestamps including milliseconds
    const logFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ level, message, timestamp, stack }) => {
        if (stack) {
          return `[${timestamp}] [${level.toUpperCase()}] ${message}\n${stack}`;
        }
        return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
      })
    );

    // Create logger instance
    const configLogLevel = getLogLevelFromConfig();
    this.logger = winston.createLogger({
      level: configLogLevel || 'info', // Environment overrides config if set
      format: logFormat,
      transports: [
        // Console transport with timestamps including milliseconds
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp, stack }) => {
              if (stack) {
                return `[${timestamp}] [${level}] ${message}\n${stack}`;
              }
              return `[${timestamp}] [${level}] ${message}`;
            })
          ),
        }),

        // File transport for all logs
        new winston.transports.File({
          filename: path.join(logsDir, 'pool.log'),
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
          tailable: true,
        }),

        // Separate error log file
        new winston.transports.File({
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
          tailable: true,
        }),
      ],
    });

    // Handle uncaught exceptions
    this.logger.exceptions.handle(
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'exceptions.log'),
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
      })
    );

    // Handle unhandled promise rejections
    this.logger.rejections.handle(
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'rejections.log'),
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
      })
    );
  }

  // Log methods - simplified without service metadata
  error(message, meta = {}) {
    this.logger.error(message, meta);
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }

  verbose(message, meta = {}) {
    this.logger.verbose(message, meta);
  }

  // Log with custom level
  log(level, message, meta = {}) {
    this.logger.log(level, message, meta);
  }

  // Create child logger for specific service (kept for backward compatibility)
  child(service) {
    return {
      error: (message, meta = {}) => this.error(message, meta),
      warn: (message, meta = {}) => this.warn(message, meta),
      info: (message, meta = {}) => this.info(message, meta),
      debug: (message, meta = {}) => this.debug(message, meta),
      verbose: (message, meta = {}) => this.verbose(message, meta),
      log: (level, message, meta = {}) => this.log(level, message, meta),
    };
  }

  // Get logger instance for direct access
  getLogger() {
    return this.logger;
  }

  // Set log level
  setLevel(level) {
    this.logger.level = level;
  }

  // Get current log level
  getLevel() {
    return this.logger.level;
  }

  // Close logger (useful for graceful shutdown)
  close() {
    this.logger.close();
  }
}

// Create singleton instance
const logger = new Logger();

// Export both the singleton and the class
module.exports = logger;
module.exports.Logger = Logger;
