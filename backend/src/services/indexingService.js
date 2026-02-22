const { ClaimsHistory, Vault, SubSchedule } = require('../models');
const priceService = require('./priceService');
const slackWebhookService = require('./slackWebhookService');
const tvlService = require('./tvlService');

const EventEmitter = require('events');
const claimEventEmitter = new EventEmitter();

class IndexingService {
  async processClaim(claimData) {
    try {
      const {
        user_address,
        token_address,
        amount_claimed,
        claim_timestamp,
        transaction_hash,
        block_number
      } = claimData;

      // Fetch the token price at the time of claim
      const price_at_claim_usd = await priceService.getTokenPrice(
        token_address,
        claim_timestamp
      );

      // Create the claim record with price data
      const claim = await ClaimsHistory.create({
        user_address,
        token_address,
        amount_claimed,
        claim_timestamp,
        transaction_hash,
        block_number,
        price_at_claim_usd
      });

      console.log(`Processed claim ${transaction_hash} with price $${price_at_claim_usd}`);
      
      // Check for large claim and send Slack alert
      try {
        await slackWebhookService.processClaimAlert(claim.toJSON());
      } catch (alertError) {
        console.error('Error processing claim alert:', alertError);
        // Don't throw - alert failure shouldn't fail the claim processing
      }
      
      // Update TVL for claim event
      try {
        await tvlService.handleClaim(claim.toJSON());
      } catch (tvlError) {
        console.error('Error updating TVL for claim:', tvlError);
        // Don't throw - TVL update failure shouldn't fail claim processing
      }
      
      // Emit internal claim event for WebSocket gateway
      claimEventEmitter.emit('claim', claim.toJSON());
      return claim;
    } catch (error) {
      console.error('Error processing claim:', error);
      throw error;
    }
  }

  async processBatchClaims(claimsData) {
    const results = [];
    const errors = [];

    for (const claimData of claimsData) {
      try {
        const result = await this.processClaim(claimData);
        results.push(result);
      } catch (error) {
        errors.push({
          transaction_hash: claimData.transaction_hash,
          error: error.message
        });
      }
    }

    return {
      processed: results.length,
      errors: errors.length,
      results,
      errors
    };
  }

  async backfillMissingPrices() {
    try {
      // Find all claims without price data
      const claimsWithoutPrice = await ClaimsHistory.findAll({
        where: {
          price_at_claim_usd: null
        },
        order: [['claim_timestamp', 'ASC']],
        limit: 100 // Process in batches to avoid rate limits
      });

      console.log(`Found ${claimsWithoutPrice.length} claims without price data`);

      for (const claim of claimsWithoutPrice) {
        try {
          const price = await priceService.getTokenPrice(
            claim.token_address,
            claim.claim_timestamp
          );

          await claim.update({ price_at_claim_usd: price });
          console.log(`Backfilled price for claim ${claim.transaction_hash}: $${price}`);
        } catch (error) {
          console.error(`Failed to backfill price for claim ${claim.transaction_hash}:`, error.message);
        }
      }

      return claimsWithoutPrice.length;
    } catch (error) {
      console.error('Error in backfillMissingPrices:', error);
      throw error;
    }
  }

  async getRealizedGains(userAddress, startDate = null, endDate = null) {
    try {
      const whereClause = {
        user_address: userAddress,
        price_at_claim_usd: {
          [require('sequelize').Op.ne]: null
        }
      };

      if (startDate) {
        whereClause.claim_timestamp = {
          [require('sequelize').Op.gte]: startDate
        };
      }

      if (endDate) {
        whereClause.claim_timestamp = {
          ...whereClause.claim_timestamp,
          [require('sequelize').Op.lte]: endDate
        };
      }

      const claims = await ClaimsHistory.findAll({
        where: whereClause,
        order: [['claim_timestamp', 'ASC']]
      });

      let totalRealizedGains = 0;

      for (const claim of claims) {
        const realizedGain = parseFloat(claim.amount_claimed) * parseFloat(claim.price_at_claim_usd);
        totalRealizedGains += realizedGain;
      }

      return {
        user_address: userAddress,
        total_realized_gains_usd: totalRealizedGains,
        claims_processed: claims.length,
        period: {
          start_date: startDate,
          end_date: endDate
        }
      };
    } catch (error) {
      console.error('Error calculating realized gains:', error);
      throw error;
    }
  }

  async processTopUpEvent(topUpData) {
    try {
      const {
        vault_address,
        top_up_amount,
        transaction_hash,
        block_number,
        timestamp,
        cliff_duration = null,
        vesting_duration
      } = topUpData;

      const vault = await Vault.findOne({
        where: { vault_address, is_active: true }
      });

      if (!vault) {
        throw new Error(`Vault ${vault_address} not found or inactive`);
      }

      const topUpTimestamp = new Date(timestamp);
      let cliffDate = null;
      let vestingStartDate = topUpTimestamp;

      if (cliff_duration && cliff_duration > 0) {
        cliffDate = new Date(topUpTimestamp.getTime() + cliff_duration * 1000);
        vestingStartDate = cliffDate;
      }

      const subSchedule = await SubSchedule.create({
        vault_id: vault.id,
        top_up_amount,
        top_up_transaction_hash: transaction_hash,
        top_up_timestamp: topUpTimestamp,
        cliff_duration,
        cliff_date: cliffDate,
        vesting_start_date: vestingStartDate,
        vesting_duration,
      });

      await vault.update({
        total_amount: parseFloat(vault.total_amount) + parseFloat(top_up_amount),
      });

      console.log(`Processed top-up ${transaction_hash} for vault ${vault_address}`);
      return subSchedule;
    } catch (error) {
      console.error('Error processing top-up event:', error);
      throw error;
    }
  }

  async processReleaseEvent(releaseData) {
    try {
      const {
        vault_address,
        user_address,
        amount_released,
        transaction_hash,
        block_number,
        timestamp
      } = releaseData;

      const vault = await Vault.findOne({
        where: { vault_address, is_active: true },
        include: [{
          model: SubSchedule,
          as: 'subSchedules',
          where: { is_active: true },
          required: false,
        }],
      });

      if (!vault) {
        throw new Error(`Vault ${vault_address} not found or inactive`);
      }

      let remainingToRelease = parseFloat(amount_released);

      for (const subSchedule of vault.subSchedules) {
        if (remainingToRelease <= 0) break;

        const releasable = this.calculateSubScheduleReleasable(subSchedule, new Date(timestamp));
        if (releasable <= 0) continue;

        const releaseFromThis = Math.min(remainingToRelease, releasable);
        
        await subSchedule.update({
          amount_released: parseFloat(subSchedule.amount_released) + releaseFromThis,
        });

        remainingToRelease -= releaseFromThis;
      }

      if (remainingToRelease > 0) {
        throw new Error(`Insufficient releasable amount. Remaining: ${remainingToRelease}`);
      }

      console.log(`Processed release ${transaction_hash} for vault ${vault_address}, amount: ${amount_released}`);
      return { success: true, amount_released };
    } catch (error) {
      console.error('Error processing release event:', error);
      throw error;
    }
  }

  calculateSubScheduleReleasable(subSchedule, asOfDate = new Date()) {
    if (subSchedule.cliff_date && asOfDate < subSchedule.cliff_date) {
      return 0;
    }

    if (asOfDate < subSchedule.vesting_start_date) {
      return 0;
    }

    const vestingEnd = new Date(subSchedule.vesting_start_date.getTime() + subSchedule.vesting_duration * 1000);
    if (asOfDate >= vestingEnd) {
      return parseFloat(subSchedule.top_up_amount) - parseFloat(subSchedule.amount_released);
    }

    const vestedTime = asOfDate - subSchedule.vesting_start_date;
    const vestedRatio = vestedTime / (subSchedule.vesting_duration * 1000);
    const totalVested = parseFloat(subSchedule.top_up_amount) * vestedRatio;
    const releasable = totalVested - parseFloat(subSchedule.amount_released);

    return Math.max(0, releasable);
  }
}

module.exports = {
  IndexingService,
  claimEventEmitter,
  instance: new IndexingService()
};
