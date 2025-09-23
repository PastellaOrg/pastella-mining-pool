const logger = require('../../utils/logger.js');

class SubmitHandlers {
  constructor(server) {
    this.server = server;
  }

  async handleGetTransactions(clientId, id) {
    const client = this.server.clients.get(clientId);
    if (!client || !client.authorized) {
      this.server.sendError(clientId, id, -1, 'Not authorized');
      return;
    }
    const currentJob = this.server.getCurrentJob();
    if (currentJob) {
      this.server.sendToClient(clientId, { id, result: currentJob.transactions, error: null });
    } else {
      this.server.sendError(clientId, id, -1, 'No job available');
    }
  }

  async handleSubmit(clientId, params, id) {
    const client = this.server.clients.get(clientId);
    if (!client || !client.authorized) {
      this.server.sendError(clientId, id, -1, 'Not authorized');
      return;
    }

    let workerName, jobId, extraNonce2, nTime, nonce, result;
    if (Array.isArray(params)) {
      [workerName, jobId, extraNonce2, nTime, nonce] = params;
    } else if (typeof params === 'object' && params !== null) {
      workerName = params.workerName || params.worker || params.user || params.id || client.workerName;
      jobId = params.jobId || params.job_id;
      extraNonce2 = params.extraNonce2 || params.extra_nonce2 || params.nonce2 || '00000000';
      nTime = params.nTime || params.time || params.timestamp || Math.floor(Date.now() / 1000).toString(16);
      nonce = params.nonce;
      result = params.result;
    } else {
      logger.error(`Invalid submit params format: ${typeof params}`);
      this.server.sendError(clientId, id, -1, 'Invalid parameters format');
      return;
    }

    if (!workerName || !jobId || !extraNonce2 || !nTime || !nonce) {
      this.server.sendError(clientId, id, -1, 'Missing parameters');
      return;
    }

    const job = this.server.jobs.get(jobId);
    if (!job) {
      this.server.sendError(clientId, id, -1, 'Job not found');
      return;
    }
    if (Date.now() > job.expiresAt) {
      this.server.sendError(clientId, id, -1, 'Job expired');
      return;
    }

    const nTimeValue = parseInt(nTime, 16);
    const shareData = {
      jobId: jobId,
      nonce: nonce,
      timestamp: nTimeValue,
      extraNonce2: extraNonce2,
      nTime: nTime,
      workerName: workerName,
    };

    try {
      const template = this.server.blockTemplateManager.getCurrentTemplate();
      if (!template) {
        this.server.sendError(clientId, id, -1, 'No block template available');
        return;
      }

      const hash = result;
      shareData.hash = hash;
      shareData.difficulty = this.server.difficultyManager ?
        this.server.difficultyManager.getClientDifficulty(clientId) :
        (client.difficulty || this.server.config.get('mining.startingDifficulty') || 50000);

      if (!this.server.shareValidator) {
        logger.error('Share validator not available');
        this.server.sendError(clientId, id, -1, 'Share validation not available');
        return;
      }

      const validation = this.server.shareValidator.validateShare(shareData, client.address || client.workerName);

      if (this.server.difficultyManager) {
        this.server.difficultyManager.recordShare(clientId, validation.valid);
      }

      if (validation.valid) {
        this.server.stats.validShares++;
        const actualDifficulty = this.server.difficultyManager ?
          this.server.difficultyManager.getClientDifficulty(clientId) :
          (client.difficulty || this.server.config.get('mining.startingDifficulty') || 50000);
        this.server.hashrateService.recordShareForHashrate(clientId, actualDifficulty);

        if (this.server.difficultyManager) {
          const adjustment = this.server.difficultyManager.checkDifficultyAdjustment(clientId);
          logger.debug(`Difficulty check for ${clientId}: ${adjustment ? 'got adjustment' : 'no adjustment'}`);
          if (adjustment && adjustment.adjusted) {
            client.difficulty = adjustment.newDifficulty;
            // Send new difficulty to miner
            logger.debug(`About to send difficulty ${adjustment.newDifficulty} to ${clientId}`);
            this.server.sendDifficulty(clientId, adjustment.newDifficulty);
            logger.info(`Difficulty adjusted for ${client.address || client.workerName}: ${adjustment.oldDifficulty} -> ${adjustment.newDifficulty}`);
          }
        }

        if (validation.isBlockSolution) {
          const template = this.server.blockTemplateManager.getCurrentTemplate();
          const blockHeight = template ? template.index : null;
          if (blockHeight !== null && this.server.processingHeights.has(blockHeight)) {
            this.server.stats.blocksFound++;
            return;
          }

          this.server.stats.blocksFound++;
          logger.info(`Block found by ${client.address || client.workerName} at height ${blockHeight}`);

          // Distribute block rewards to all contributors
          if (this.server.databaseManager) {
            try {
              await this.distributeBlockReward(blockHeight, shareData.hash);
              logger.info(`Distributed block rewards for block ${blockHeight}`);
            } catch (error) {
              logger.error(`Failed to distribute block rewards: ${error.message}`);
            }
          }

          this.server.sendToClient(clientId, { id, result: { status: 'WAIT' }, error: null });

          if (validation.blockSubmissionPromise) {
            this.server.blockCoordinator.handleBlockSubmission(validation.blockSubmissionPromise, clientId);
          } else {
            logger.warn('No block submission promise available for block solution');
          }
          return;
        }

        this.server.sendToClient(clientId, { id, result: { status: 'OK' }, error: null });
        logger.info(`Share accepted from ${client.address || client.workerName} (IP: ${client.socket.remoteAddress}, Job: ${jobId})`);
      } else {
        this.server.stats.invalidShares++;
        this.server.sendError(clientId, id, -1, `Invalid share: ${validation.reason}`);
        logger.info(`Share rejected from ${client.address || client.workerName}: ${validation.reason}`);
      }
    } catch (error) {
      logger.error(`Share processing error from ${client.address || client.workerName}: ${error.message}`);
      this.server.sendError(clientId, id, -1, 'Share processing error');
    }

    this.server.stats.totalShares++;
  }

  async distributeBlockReward(blockHeight, blockHash) {
    const blockReward = 50.0; // PAS per block
    const poolFeePercent = 1.0; // 1% pool fee
    const timeWindow = 600000; // 10 minutes - shares that contributed to this block
    
    // Get all miners who contributed shares in the time window leading to this block
    const totalShares = await this.server.databaseManager.getTotalPoolShares(timeWindow);
    if (totalShares === 0) {
      logger.warn(`No shares found for block reward distribution (block ${blockHeight})`);
      return;
    }

    // Calculate net reward after pool fee
    const poolFee = blockReward * (poolFeePercent / 100);
    const netReward = blockReward - poolFee;
    
    // Block hash is now passed as parameter from the share submission context
    
    // Get all unique miners from recent shares
    const miners = await this.server.databaseManager.getMinersWithShares(timeWindow);
    
    // Calculate total pool hashrate (estimated from recent hashrate data)
    let totalPoolHashrate = 0;
    try {
      // Get current miners' hashrates
      const currentMiners = await this.server.databaseManager.getAllMiners();
      totalPoolHashrate = currentMiners.reduce((sum, miner) => sum + (miner.hashrate || 0), 0);
    } catch (error) {
      logger.warn(`Could not calculate total pool hashrate: ${error.message}`);
    }
    
    for (const minerData of miners) {
      const minerShares = minerData.share_count;
      const minerAddress = minerData.miner_id;
      
      // Calculate this miner's share of the reward (PPLNS)
      // Fix: Cap minerContribution at 1.0 to prevent over 100% when single miner has many shares
      const minerContribution = Math.min(minerShares / totalShares, 1.0);
      const minerReward = netReward * minerContribution;
      const minerPercentage = minerContribution * 100; // Convert to percentage
      
      // Get miner's current hashrate for the record
      let minerHashrate = 0;
      try {
        const minerRecord = await this.server.databaseManager.get(
          'SELECT hashrate FROM miners WHERE address = ? ORDER BY last_seen DESC LIMIT 1',
          [minerAddress]
        );
        minerHashrate = minerRecord ? minerRecord.hashrate : 0;
      } catch (error) {
        logger.debug(`Could not get miner hashrate for ${minerAddress}: ${error.message}`);
      }
      
      if (minerReward > 0) {
        // Add to unconfirmed balance - use our fixed reward calculation instead of recalculating
        const existingRecord = await this.server.databaseManager.get(
          'SELECT address FROM leaderboard WHERE address = ?', 
          [minerAddress]
        );

        const { toAtomicUnits } = require('../../utils/atomicUnits.js');
        const minerRewardAtomic = toAtomicUnits(minerReward);

        if (!existingRecord) {
          await this.server.databaseManager.addMinerToLeaderboard(minerAddress, {
            worker_count: 1,
            total_hashrate: 0,
            confirmed_balance: 0,
            unconfirmed_balance: minerRewardAtomic,
            total_paid: 0,
            total_shares: minerShares,
            valid_shares: minerShares,
            rejected_shares: 0,
            blocks_found: 0
          });
        } else {
          await this.server.databaseManager.run(
            `UPDATE leaderboard SET unconfirmed_balance = unconfirmed_balance + ? WHERE address = ?`,
            [minerRewardAtomic, minerAddress]
          );
        }
        
        // Store per-block reward data (new functionality)
        try {
          await this.server.databaseManager.addBlockReward({
            block_height: blockHeight,
            block_hash: blockHash,
            miner_address: minerAddress,
            base_reward: blockReward,
            pool_fee: poolFee,
            miner_reward: minerReward,
            pool_hashrate: totalPoolHashrate,
            miner_hashrate: minerHashrate,
            miner_percentage: minerPercentage,
            timestamp: Date.now()
          });
          
          logger.debug(`Block reward stored: ${minerAddress} received ${minerReward.toFixed(6)} PAS (${minerPercentage.toFixed(2)}%) for block ${blockHeight}`);
        } catch (error) {
          logger.error(`Failed to store block reward for ${minerAddress}: ${error.message}`);
        }
        
        logger.debug(`Block reward distributed: ${minerAddress} received ${minerReward.toFixed(6)} PAS for ${minerShares}/${totalShares} shares`);
      }
    }
    
    logger.info(`Block ${blockHeight}: Distributed ${netReward} PAS among ${miners.length} miners (${poolFee} PAS pool fee)`);
  }
}

module.exports = SubmitHandlers;




