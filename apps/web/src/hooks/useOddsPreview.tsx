import { useMemo } from 'react';

import { Market } from '@/lib/grpc';
import { BetSide } from '@/lib/chains/solana';

interface OddsPreview {
  payout: number;
  odds: number;
  isValid: boolean;
  impliedProbability: number;
  newTotalStaked: number;
  priceImpact: number;
}

export function useOddsPreview(
  market: Market | undefined | null,
  side: BetSide,
  amountString: string
): OddsPreview {
  return useMemo(() => {
    if (!market || !amountString) {
      return {
        payout: 0,
        odds: 0,
        isValid: false,
        impliedProbability: 0,
        newTotalStaked: 0,
        priceImpact: 0,
      };
    }

    const amount = parseFloat(amountString);
    
    if (isNaN(amount) || amount <= 0) {
      return {
        payout: 0,
        odds: 0,
        isValid: false,
        impliedProbability: 0,
        newTotalStaked: 0,
        priceImpact: 0,
      };
    }

    // Convert to lamports (assuming 6 decimals for USDC)
    const amountLamports = amount * Math.pow(10, 6);
    
    const currentStakedA = market.stakedA || 0;
    const currentStakedB = market.stakedB || 0;
    const currentTotal = currentStakedA + currentStakedB;
    
    // Calculate new stakes after this bet
    const isSelectedSideA = 'a' in side;
    const newStakedA = currentStakedA + (isSelectedSideA ? amountLamports : 0);
    const newStakedB = currentStakedB + (!isSelectedSideA ? amountLamports : 0);
    const newTotal = newStakedA + newStakedB;
    
    // Calculate fee
    const feeAmount = (newTotal * market.feeBps) / 10000;
    const distributable = newTotal - feeAmount;
    
    // Calculate payout
    const winningSideStake = isSelectedSideA ? newStakedA : newStakedB;
    const payout = winningSideStake > 0 ? 
      (distributable * amountLamports) / winningSideStake : 0;
    
    // Convert back from lamports
    const payoutTokens = payout / Math.pow(10, 6);
    
    // Calculate odds
    const odds = payoutTokens / amount;
    
    // Calculate implied probability
    const impliedProbability = odds > 0 ? (1 / odds) * 100 : 0;
    
    // Calculate price impact
    const oldOddsA = currentTotal > 0 ? currentTotal / (currentStakedA || 1) : 1;
    const oldOddsB = currentTotal > 0 ? currentTotal / (currentStakedB || 1) : 1;
    const newOddsA = newStakedA > 0 ? newTotal / newStakedA : Infinity;
    const newOddsB = newStakedB > 0 ? newTotal / newStakedB : Infinity;
    
    const oldOdds = isSelectedSideA ? oldOddsA : oldOddsB;
    const newOdds = isSelectedSideA ? newOddsA : newOddsB;
    const priceImpact = oldOdds > 0 ? ((oldOdds - newOdds) / oldOdds) * 100 : 0;
    
    return {
      payout: payoutTokens,
      odds,
      isValid: true,
      impliedProbability,
      newTotalStaked: newTotal / Math.pow(10, 6),
      priceImpact: Math.abs(priceImpact),
    };
  }, [market, side, amountString]);
}

// Helper hook for calculating current odds without a bet
export function useCurrentOdds(market: Market | undefined | null) {
  return useMemo(() => {
    if (!market) {
      return {
        sideAOdds: 1,
        sideBOdds: 1,
        sideAProb: 50,
        sideBProb: 50,
        totalStaked: 0,
      };
    }

    const stakedA = market.stakedA || 0;
    const stakedB = market.stakedB || 0;
    const total = stakedA + stakedB;
    
    if (total === 0) {
      return {
        sideAOdds: 1,
        sideBOdds: 1,
        sideAProb: 50,
        sideBProb: 50,
        totalStaked: 0,
      };
    }
    
    const sideAOdds = stakedA > 0 ? total / stakedA : Infinity;
    const sideBOdds = stakedB > 0 ? total / stakedB : Infinity;
    
    const sideAProb = stakedA > 0 ? (stakedA / total) * 100 : 0;
    const sideBProb = stakedB > 0 ? (stakedB / total) * 100 : 0;
    
    return {
      sideAOdds,
      sideBOdds,
      sideAProb,
      sideBProb,
      totalStaked: total / Math.pow(10, 6),
    };
  }, [market]);
}