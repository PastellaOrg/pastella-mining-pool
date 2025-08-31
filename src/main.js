const MiningPool = require('./pool.js');
const logger = require('./utils/logger.js');

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  if (pool) {
    pool
      .stop()
      .then(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      })
      .catch(error => {
        logger.error(`Error during shutdown: ${error.message}`);
        process.exit(1);
      });
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  if (pool) {
    pool
      .stop()
      .then(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      })
      .catch(error => {
        logger.error(`Error during shutdown: ${error.message}`);
        process.exit(1);
      });
  } else {
    process.exit(0);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', error => {
  logger.error(`Uncaught exception: ${error.message}`);
  logger.error(`Stack trace: ${error.stack}`);

  if (pool) {
    pool
      .stop()
      .then(() => {
        logger.error('Pool stopped due to uncaught exception');
        process.exit(1);
      })
      .catch(stopError => {
        logger.error(`Error stopping pool: ${stopError.message}`);
        process.exit(1);
      });
  } else {
    process.exit(1);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled promise rejection: ${reason}`);
  logger.error(`Promise: ${promise}`);

  if (pool) {
    pool
      .stop()
      .then(() => {
        logger.error('Pool stopped due to unhandled promise rejection');
        process.exit(1);
      })
      .catch(stopError => {
        logger.error(`Error stopping pool: ${stopError.message}`);
        process.exit(1);
      });
  } else {
    process.exit(1);
  }
});

// Start the mining pool
let pool = null;

async function startPool() {
  try {
    logger.info('Starting Pastella Mining Pool...');

    pool = new MiningPool();
    const success = await pool.start();

    if (success) {
      logger.info('Mining pool started successfully');

      // Log pool information
      const poolInfo = pool.getPoolInfo();
      logger.info(`Pool: ${poolInfo.name} v${poolInfo.version}`);
      logger.info(`Algorithm: ${poolInfo.algorithm}`);
      logger.info(`Fee: ${poolInfo.fee * 100}%`);
      logger.info(`Min Payout: ${poolInfo.minPayout} PSTL`);

      // Fallback keep-alive: ensure process stays alive even if no handles are open
      // In normal operation, HTTP and Stratum servers keep the event loop alive.
      // This is a no-op timer to guard against unexpected exits during startup.
      if (!process.env.NO_KEEPALIVE) {
        setInterval(() => {}, 1 << 30);
      }
    } else {
      logger.error('Failed to start mining pool (pool.start() returned false)');
      // Delay exit slightly to allow logs to flush to console/files
      setTimeout(() => process.exit(1), 50);
    }
  } catch (error) {
    logger.error(`Failed to start mining pool: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
    // Delay exit slightly to allow logs to flush to console/files
    setTimeout(() => process.exit(1), 50);
  }
}

// Start the pool
startPool();
