const axios = require('axios');
const logger = require('../utils/logger.js');
const { toAtomicUnits, fromAtomicUnits } = require('../utils/atomicUnits.js');

class PaymentProcessor {
  constructor(pool) {
    this.pool = pool;
    this.config = pool.config;
    this.database = pool.database;

    // Payment configuration
    this.paymentConfig = {
      enabled: this.config.get('payout.enabled') || false,
      interval: this.config.get('payout.paymentInterval') || 300000, // 5 minutes
      minPayout: this.config.get('payout.minPayout') || 0.001,
      minPayoutAtomic: toAtomicUnits(this.config.get('payout.minPayout') || 0.001),
      paymentFee: this.config.get('payout.paymentFee') || 100000, // 100000 atomic units
      batchSize: this.config.get('payout.batchSize') || 50,
      walletName: this.config.get('payout.walletName') || 'pool-wallet',
      walletPassword: this.config.get('payout.walletPassword') || '',
      walletApiUrl: this.config.get('payout.walletApiUrl') || 'http://localhost:3001',
      walletApiKey: this.config.get('payout.walletApiKey') || ''
    };

    // Setup wallet API client
    this.walletAPI = axios.create({
      baseURL: this.paymentConfig.walletApiUrl,
      timeout: 30000,
      headers: {
        'X-API-Key': this.paymentConfig.walletApiKey,
        'Content-Type': 'application/json'
      }
    });

    this.paymentInterval = null;
    this.isProcessing = false;

    logger.info(`Payment processor initialized - Interval: ${this.paymentConfig.interval}ms, Min payout: ${this.paymentConfig.minPayout} PAS`);
  }

  start() {
    if (!this.paymentConfig.enabled) {
      logger.info('Payment processor is disabled in configuration');
      return;
    }

    if (this.paymentInterval) {
      logger.warn('Payment processor is already running');
      return;
    }

    logger.info(`Starting payment processor - payments every ${this.paymentConfig.interval / 1000} seconds`);

    // Run first payment check after 30 seconds
    setTimeout(() => {
      this.processPayments();
    }, 30000);

    // Set up recurring payments
    this.paymentInterval = setInterval(() => {
      this.processPayments();
    }, this.paymentConfig.interval);
  }

  stop() {
    if (this.paymentInterval) {
      clearInterval(this.paymentInterval);
      this.paymentInterval = null;
      logger.info('Payment processor stopped');
    }
  }

  async processPayments() {
    if (this.isProcessing) {
      logger.debug('Payment processing already in progress, skipping this cycle');
      return;
    }

    this.isProcessing = true;

    try {
      logger.debug('Starting payment processing cycle');

      // Get miners eligible for payment
      const eligibleMiners = await this.database.getMinersForPayment(this.paymentConfig.minPayoutAtomic);

      if (!eligibleMiners || eligibleMiners.length === 0) {
        logger.debug('No miners eligible for payment');
        return;
      }

      logger.info(`Found ${eligibleMiners.length} miners eligible for payment`);

      // Prepare payment outputs for multi-transaction
      const paymentOutputs = [];
      const batchId = `batch_${Date.now()}`;

      for (const miner of eligibleMiners) {
        const grossAmountAtomic = miner.confirmed_balance;
        const feeAtomic = this.paymentConfig.paymentFee;
        const netAmountAtomic = grossAmountAtomic - feeAtomic;

        if (netAmountAtomic <= 0) {
          logger.warn(`Miner ${miner.address} balance ${fromAtomicUnits(grossAmountAtomic)} PAS is insufficient to cover fee ${fromAtomicUnits(feeAtomic)} PAS`);
          continue;
        }

        paymentOutputs.push({
          address: miner.address,
          amount: netAmountAtomic, // amount in atomic units
          grossAmount: grossAmountAtomic,
          fee: feeAtomic
        });
      }

      if (paymentOutputs.length === 0) {
        logger.info('No valid payment outputs after fee calculation');
        return;
      }

      // Load wallet if not loaded
      await this.ensureWalletLoaded();

      // Process payments in batches
      const batches = this.chunkArray(paymentOutputs, this.paymentConfig.batchSize);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchBatchId = `${batchId}_${i + 1}`;

        try {
          await this.processBatch(batchBatchId, batch);
        } catch (error) {
          logger.error(`Failed to process payment batch ${batchBatchId}: ${error.message}`);
        }
      }

    } catch (error) {
      logger.error(`Payment processing failed: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    } finally {
      this.isProcessing = false;
    }
  }

  async processBatch(batchId, outputs) {
    try {
      logger.info(`Processing payment batch ${batchId} with ${outputs.length} recipients`);

      // For now, use individual transactions since we're not sure about multi-send endpoint
      // In the future, this could be optimized to use multi-output transactions
      const transactionIds = [];

      for (const output of outputs) {
        const paymentData = {
          walletName: this.paymentConfig.walletName,
          toAddress: output.address,
          amount: output.amount, // Keep in atomic units
          fee: this.paymentConfig.paymentFee, // Keep in atomic units
          tag: `Pool payment ${batchId}`
        };

        logger.debug(`Sending payment request to wallet API:`, paymentData);

        try {
          const response = await this.walletAPI.post('/api/wallet/send', paymentData);
          transactionIds.push(response.data.transactionId);
        } catch (apiError) {
          logger.error(`Wallet API error for ${output.address}:`);
          logger.error(`Request data:`, paymentData);
          logger.error(`Response status: ${apiError.response?.status}`);
          logger.error(`Response data:`, apiError.response?.data);
          logger.error(`Error message: ${apiError.message}`);
          throw apiError;
        }
      }

      const transactionId = transactionIds.join(','); // Store multiple transaction IDs
      logger.info(`Payment batch ${batchId} submitted with transaction ID: ${transactionId}`);

      // Record payments in database
      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i];
        const txId = transactionIds[i];

        await this.database.recordPayment(
          batchId,
          txId,
          output.address,
          output.grossAmount,
          output.fee,
          output.amount
        );

        // Update miner balance immediately
        await this.database.updateMinerBalanceAfterPayment(output.address, output.grossAmount);

        // Update payment status
        await this.database.updatePaymentStatus(txId, 'submitted');

        logger.info(`Payment recorded for ${output.address}: ${fromAtomicUnits(output.amount)} PAS (fee: ${fromAtomicUnits(output.fee)} PAS, TX: ${txId})`);
      }

      logger.info(`Successfully processed payment batch ${batchId} - ${outputs.length} payments totaling ${fromAtomicUnits(outputs.reduce((sum, o) => sum + o.amount, 0))} PAS`);

    } catch (error) {
      logger.error(`Failed to process payment batch ${batchId}: ${error.message}`);

      // Record failed payments in database
      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i];
        const failedTxId = `failed_${batchId}_${i}_${Date.now()}`;

        try {
          await this.database.recordPayment(
            batchId,
            failedTxId,
            output.address,
            output.grossAmount,
            output.fee,
            output.amount
          );
          await this.database.updatePaymentStatus(failedTxId, 'failed', error.message);
        } catch (dbError) {
          logger.error(`Failed to record failed payment for ${output.address}: ${dbError.message}`);
        }
      }

      throw error;
    }
  }

  async ensureWalletLoaded() {
    try {
      // Check if wallet is already loaded
      const walletInfo = await this.walletAPI.get(`/api/wallet/info/${this.paymentConfig.walletName}`);
      logger.debug(`Wallet ${this.paymentConfig.walletName} is loaded`);
      return;
    } catch (error) {
      if (error.response?.status === 404) {
        // Wallet not loaded, try to load it
        logger.info(`Loading wallet ${this.paymentConfig.walletName}`);
        await this.walletAPI.post('/api/wallet/load', {
          walletName: this.paymentConfig.walletName,
          password: this.paymentConfig.walletPassword
        });
        logger.info(`Wallet ${this.paymentConfig.walletName} loaded successfully`);
      } else {
        throw new Error(`Failed to check/load wallet: ${error.message}`);
      }
    }
  }

  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  async getPaymentStats() {
    return await this.database.getPaymentStats();
  }

  async getPaymentHistory(minerAddress = null, limit = 50, offset = 0) {
    return await this.database.getPaymentHistory(minerAddress, limit, offset);
  }
}

module.exports = PaymentProcessor;