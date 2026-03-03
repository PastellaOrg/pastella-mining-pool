import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, Tooltip, ResponsiveContainer } from 'recharts';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGift } from '@fortawesome/free-solid-svg-icons';
import apiService from '../../services/api';
import moment from 'moment';
import config from '../../config/pool';
import type { PoolConfig, PoolStats, Block, Payment, Miner, ApiResponse, ApiBlock } from '../../types';

const Dashboard: React.FC = () => {
  const [poolStats, setPoolStats] = useState<PoolStats | null>(null);
  const [poolConfig, setPoolConfig] = useState<PoolConfig | null>(null);
  const [recentBlocks, setRecentBlocks] = useState<Block[]>([]);
  const [recentPayments, setRecentPayments] = useState<Payment[]>([]);
  const [topMiners, setTopMiners] = useState<Miner[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [apiData, setApiData] = useState<ApiResponse | null>(null);
  const [calculatorHashRateValue, setCalculatorHashRateValue] = useState<string>('');
  const [calculatorHashRateUnit, setCalculatorHashRateUnit] = useState<string>('KH/s');

  const formatHashRate = (hashRate: number | undefined): string => {
    if (!hashRate || hashRate === 0) return '0 H/s';
    if (hashRate >= 1000000000000000) return `${(hashRate / 1000000000000000).toFixed(2)} PH/s`;
    if (hashRate >= 1000000000000) return `${(hashRate / 1000000000000).toFixed(2)} TH/s`;
    if (hashRate >= 1000000000) return `${(hashRate / 1000000000).toFixed(2)} GH/s`;
    if (hashRate >= 1000000) return `${(hashRate / 1000000).toFixed(2)} MH/s`;
    if (hashRate >= 1000) return `${(hashRate / 1000).toFixed(2)} KH/s`;
    return `${hashRate.toFixed(2)} H/s`;
  };

  const formatLargeNumber = (num: number): string => {
    if (num >= 1e15) return `${(num / 1e15).toFixed(2)} P`;
    if (num >= 1e12) return `${(num / 1e12).toFixed(2)} T`;
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)} G`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)} M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)} K`;
    return num.toFixed(2);
  };

  const formatHashes = (hashes: number | undefined): string => {
    if (!hashes || hashes === 0) return '0';
    if (hashes >= 1e24) return `${(hashes / 1e24).toFixed(2)} Y`;
    if (hashes >= 1e21) return `${(hashes / 1e21).toFixed(2)} Z`;
    if (hashes >= 1e18) return `${(hashes / 1e18).toFixed(2)} E`;
    if (hashes >= 1e15) return `${(hashes / 1e15).toFixed(2)} P`;
    if (hashes >= 1e12) return `${(hashes / 1e12).toFixed(2)} T`;
    if (hashes >= 1e9) return `${(hashes / 1e9).toFixed(2)} G`;
    if (hashes >= 1e6) return `${(hashes / 1e6).toFixed(2)} M`;
    if (hashes >= 1e3) return `${(hashes / 1e3).toFixed(2)} K`;
    return hashes.toFixed(2);
  };

  const formatAmount = (amount: number): string => {
    if (!poolConfig || amount === undefined || amount === null) return '0';
    if (amount === 0) return '0';
    const decimals = poolConfig.decimals ?? poolConfig.coinDecimalPlaces ?? 12;
    return (amount / Math.pow(10, decimals)).toFixed(decimals);
  };

  // Parse hash rate input with unit
  const parseHashRateInput = (value: string, unit: string): number => {
    if (!value) return 0;
    const numValue = parseFloat(value.replace(/,/g, ''));
    if (isNaN(numValue)) return 0;

    switch (unit) {
      case 'PH/s': return numValue * 1e15;
      case 'TH/s': return numValue * 1e12;
      case 'GH/s': return numValue * 1e9;
      case 'MH/s': return numValue * 1e6;
      case 'KH/s': return numValue * 1e3;
      default: return numValue;
    }
  };

  // Calculate profitability per day and month
  const calculateProfitability = (hashRate: number) => {
    if (!poolStats?.network?.hashRate || !apiData?.lastblock?.reward || !poolConfig) {
      return { daily: 0, monthly: 0 };
    }

    const networkHashRate = poolStats.network.hashRate;
    const blockReward = apiData.lastblock.reward / Math.pow(10, poolConfig.decimals ?? poolConfig.coinDecimalPlaces ?? 12);
    const secondsPerDay = 86400;

    // Estimate blocks per day based on network hashrate
    const networkBlocksPerDay = secondsPerDay / (poolConfig.blockTime || 120);

    // User's share of network hashrate
    const userShare = hashRate / networkHashRate;

    // Daily earnings (accounting for pool fee)
    const poolFee = apiData.config.fee / 100;
    const dailyEarnings = networkBlocksPerDay * blockReward * userShare * (1 - poolFee);
    const monthlyEarnings = dailyEarnings * 30;

    return {
      daily: dailyEarnings,
      monthly: monthlyEarnings
    };
  };

  // Parse blocks from API data - now handles structured objects from backend
  const parseBlocks = (apiData: ApiResponse): Block[] => {
    const blocks: Block[] = [];
    if (apiData.pool.blocks && Array.isArray(apiData.pool.blocks)) {
      // API now returns structured objects: { height, type, miner, hash, timestamp, difficulty, shares, status, reward, ... }
      for (const blockData of apiData.pool.blocks) {
        // Check if it's already a structured object (new format)
        const apiBlock = blockData as unknown as ApiBlock;
        if (typeof blockData === 'object' && 'height' in apiBlock) {
          blocks.push({
            height: apiBlock.height || 0,
            timestamp: apiBlock.timestamp || 0,
            difficulty: apiBlock.difficulty || 0,
            hash: apiBlock.hash || '',
            status: apiBlock.status || 'pending',
            reward: apiBlock.reward || 0,
            miner: apiBlock.miner || '',
            type: apiBlock.type || 'prop',
            shares: apiBlock.shares || 0,
            effort: apiBlock.effort || 0,
          });
        }
        // Legacy format: colon-delimited string (for backward compatibility)
        else if (typeof blockData === 'string') {
          try {
            const parts = blockData.split(':');

            // Simple format - just a block height (confirmed blocks without details)
            if (parts.length === 1 && !isNaN(parseInt(parts[0]))) {
              blocks.push({
                height: parseInt(parts[0]),
                timestamp: 0,
                difficulty: 0,
                hash: '',
                status: 'confirmed',
                reward: 0,
              });
            }
            // New format with minerScore (10 parts for matured, 8 parts for candidates)
            // Format: type:miner:hash:timestamp:difficulty:shares:score:minerScore:orphaned:reward
            else if (parts.length >= 10) {
              const type = parts[0];
              const miner = parts[1];
              const hash = parts[2];
              const timestamp = parseInt(parts[3]);
              const difficulty = parseInt(parts[4]);
              const shares = parseInt(parts[5]) || 0;
              const orphaned = parts[8];
              const reward = parseFloat(parts[9]) || 0;
              const effort = difficulty > 0 ? (shares / difficulty * 100) : 0;

              const status: 'pending' | 'confirmed' | 'orphaned' = orphaned === 'true' ? 'orphaned' : 'confirmed';

              blocks.push({
                height: 0, // Height not available in this format
                timestamp: timestamp,
                difficulty: difficulty,
                hash: hash || '',
                status: status,
                reward: reward,
                miner: miner,
                type: type,
                shares: shares,
                effort: effort,
              });
            }
            // Old format without minerScore (8 parts for matured)
            // Format: type:miner:hash:timestamp:difficulty:shares:score:orphaned:reward
            else if (parts.length >= 8) {
              const type = parts[0];
              const miner = parts[1];
              const hash = parts[2];
              const timestamp = parseInt(parts[3]);
              const difficulty = parseInt(parts[4]);
              const shares = parseInt(parts[5]) || 0;
              const orphaned = parts[6];
              const reward = parseFloat(parts[7]) || 0;
              const effort = difficulty > 0 ? (shares / difficulty * 100) : 0;

              const status: 'pending' | 'confirmed' | 'orphaned' = orphaned === 'true' ? 'orphaned' : 'confirmed';

              blocks.push({
                height: 0, // Height not available in this format
                timestamp: timestamp,
                difficulty: difficulty,
                hash: hash || '',
                status: status,
                reward: reward,
                miner: miner,
                type: type,
                shares: shares,
                effort: effort,
              });
            }
            // Candidate blocks (7 parts)
            // Format: type:miner:hash:timestamp:difficulty:shares:score
            else if (parts.length >= 7) {
              const type = parts[0];
              const miner = parts[1];
              const hash = parts[2];
              const timestamp = parseInt(parts[3]);
              const difficulty = parseInt(parts[4]);
              const shares = parseInt(parts[5]) || 0;
              const effort = difficulty > 0 ? (shares / difficulty * 100) : 0;

              blocks.push({
                height: 0, // Height not available in this format
                timestamp: timestamp,
                difficulty: difficulty,
                hash: hash || '',
                status: 'pending',
                reward: 400000000, // Default expected reward
                miner: miner,
                type: type,
                shares: shares,
                effort: effort,
              });
            }
          } catch {
            console.error('Error parsing block string:', blockData);
          }
        }
      }
    }
    return blocks;
  };

  // Parse payments from API data
  const parsePayments = (apiData: ApiResponse): Payment[] => {
    const payments: Payment[] = [];
    if (apiData.pool.payments && Array.isArray(apiData.pool.payments)) {
      // Check if it's already in object format (new format)
      if (apiData.pool.payments.length > 0 && typeof apiData.pool.payments[0] === 'object') {
        return apiData.pool.payments as unknown as Payment[];
      }

      // Legacy format: colon-delimited strings (for backward compatibility)
      apiData.pool.payments.forEach((paymentStr: string) => {
        try {
          const parts = paymentStr.split(':');
          // Format: txHash:amount:fee:ringSize:destinationsCount:address
          if (parts.length >= 3) {
            payments.push({
              txHash: parts[0] || '',
              amount: parseFloat(parts[1]) || 0,
              fee: parseFloat(parts[2]) || 0,
              timestamp: 0, // Not available in old format
              address: parts[5] || undefined
            });
          }
        } catch {
          console.error('Error parsing payment:', paymentStr);
        }
      });
    }
    return payments;
  };

  // Initial data fetch on mount
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);

        // Fetch pool stats
        const data = await apiService.getPoolStats() as unknown as ApiResponse;
        setApiData(data);

        // Debug: log the raw shares value
        console.log('Raw totalShares from API:', data.pool.totalShares);
        console.log('Raw totalSharesSolo from API:', data.pool.totalSharesSolo);

        // Transform API data to our format
        const transformedPoolStats: PoolStats = {
          hashRate: data.pool.hashrate,
          miners: data.pool.miners,
          workers: data.pool.workers,
          totalHashes: data.pool.totalShares || 0,
          totalShares: Math.round((data.pool.totalShares || 0) / 1000),
          blocks: {
            candidates: 0,
            confirmed: data.pool.totalBlocks,
            orphaned: data.pool.totalBlocksSolo || 0,
          },
          lastBlockFound: parseInt(data.pool.lastBlockFound) || undefined,
          network: {
            hashRate: data.network.difficulty / data.config.coinDifficultyTarget,
            difficulty: data.network.difficulty,
            height: data.network.height,
          },
        };

        setPoolStats(transformedPoolStats);

        // Transform config to our format
        const transformedConfig: PoolConfig = {
          name: data.config.coin,
          coin: data.config.coin,
          ticker: data.config.symbol,
          algorithm: data.config.cnAlgorithm,
          decimals: data.config.coinDecimalPlaces,
          poolFee: data.config.fee,
          minPayout: data.config.minPaymentThreshold / Math.pow(10, data.config.coinDecimalPlaces),
          payoutInterval: data.config.paymentsInterval,
          ports: data.config.ports.reduce((acc, port) => {
            const key = port.difficulty <= 1000 ? 'low' :
                       port.difficulty <= 15000 ? 'medium' :
                       port.difficulty <= 25000 ? 'high' : 'superHigh';
            acc[key] = {
              port: port.port,
              difficulty: port.difficulty,
              desc: port.desc
            };
            return acc;
          }, {} as Record<string, { port: number; difficulty: number; desc: string }>),
          blockTime: data.config.coinDifficultyTarget,
        };

        setPoolConfig(transformedConfig);

        // Parse blocks and payments from main API
        setRecentBlocks(parseBlocks(data));
        setRecentPayments(parsePayments(data));

        // Fetch top miners
        try {
          const topMinersData = await apiService.getTopMiners({ sortBy: 'hashrate' });
          const miners = topMinersData.miners || [];

          // Calculate current time once during data fetch, not during render
          const now = Math.floor(Date.now() / 1000);

          // Transform miner data format if needed
          const transformedMiners = miners.map((m: Miner & { miner?: string; hashrate?: number; hashes?: number | string; lastShare?: string }) => {
            const lastShare = m.lastShare;
            const lastShareTime = lastShare ? (typeof lastShare === 'string' ? parseInt(lastShare) : lastShare) : 0;
            const secondsAgo = lastShareTime ? now - lastShareTime : Infinity;
            const isActive = secondsAgo < 300;

            return {
              address: m.miner || m.address,
              hashRate: m.hashrate || m.hashRate,
              hashes: m.hashes ? (typeof m.hashes === 'string' ? parseFloat(m.hashes) : m.hashes) : undefined,
              lastShare: lastShare,
              isActive: isActive
            };
          });
          setTopMiners(transformedMiners);
        } catch (e) {
          console.error('Error fetching top miners:', e);
          setTopMiners([]);
        }

        setLastUpdate(new Date());
        setLoading(false);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
        setLoading(false);
      }
    };

    loadInitialData();

    // Set up polling for live stats
    const pollInterval = setInterval(async () => {
      try {
        const data = await apiService.getPoolStats() as unknown as ApiResponse;
        setApiData(data);

        const transformedPoolStats: PoolStats = {
          hashRate: data.pool.hashrate,
          miners: data.pool.miners,
          workers: data.pool.workers,
          totalHashes: data.pool.totalShares || 0,
          totalShares: Math.round((data.pool.totalShares || 0) / 1000),
          blocks: {
            candidates: 0,
            confirmed: data.pool.totalBlocks,
            orphaned: data.pool.totalBlocksSolo || 0,
          },
          lastBlockFound: parseInt(data.pool.lastBlockFound) || undefined,
          network: {
            hashRate: data.network.difficulty / data.config.coinDifficultyTarget,
            difficulty: data.network.difficulty,
            height: data.network.height,
          },
        };

        setPoolStats(transformedPoolStats);
        setRecentBlocks(parseBlocks(data));
        setRecentPayments(parsePayments(data));
        setLastUpdate(new Date());
      } catch (error) {
        console.error('Error polling live stats:', error);
      }
    }, 5000);

    return () => {
      clearInterval(pollInterval);
    };
  }, []);

  if (loading && !poolStats) {
    return (
      <div className="text-center py-5" style={{ marginTop: '100px' }}>
        <div className="spinner-border" role="status" style={{
          color: 'rgb(255 192 251)',
          width: '3rem',
          height: '3rem'
        }}>
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  const totalPoolHashRate = (poolStats?.hashRate || 0);
  const totalSoloHashRate = apiData?.pool.hashrateSolo || 0;
  const totalMiners = (poolStats?.miners || 0) + (apiData?.pool.minersSolo || 0);
  const totalBlocks = (poolStats?.blocks?.confirmed || 0) + (apiData?.pool.totalBlocksSolo || 0);

  return (
    <div>
      {/* Pool Header */}
      <div className="card card-dark" style={{
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '12px',
        background: '#282729',
        marginBottom: '30px'
      }}>
        <div className="card-header p-3" style={{
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          background: 'linear-gradient(135deg, #282729 0%, #222123 100%)',
          borderRadius: '12px 12px 0 0'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '25px' }}>
            <div className="hide-mobile">
              <h1 style={{ fontSize: '2rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                <span style={{ color: 'rgb(255 192 251)' }}>Pas</span>tella Pool
              </h1>
            </div>
            <div className="mobile-stats-grid" style={{ display: 'flex', gap: '25px', alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Hashrate</div>
                <div className="mobile-lg-text" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'rgb(255 192 251)', lineHeight: 1 }}>
                  {formatHashRate(totalPoolHashRate + totalSoloHashRate)}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Miners</div>
                <div className="mobile-lg-text" style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ffffff', lineHeight: 1 }}>
                  {totalMiners}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Blocks</div>
                <div className="mobile-lg-text" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'rgb(255 192 251)', lineHeight: 1 }}>
                  {totalBlocks}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Block Finder Bonus Info */}
      <div className="card card-dark block-finder-bonus" style={{
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '12px',
        background: 'rgba(255, 192, 251, 0.05)',
        marginBottom: '30px'
      }}>
        <div className="card-body" style={{ padding: '16px 24px', textAlign: 'center' }}>
          <div className="block-finder-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <FontAwesomeIcon icon={faGift} style={{ fontSize: '1.5rem', color: 'rgb(255 192 251)' }} />
            <div className="mobile-sm-text" style={{ fontSize: '0.875rem', color: 'rgba(255, 255, 255, 0.8)', lineHeight: 1.5 }}>
              <span style={{ color: 'rgb(255 192 251)', fontWeight: 600 }}>Block Finder Bonus:</span> During pool mining, 1% of the block reward goes directly to the miner who finds the block!
            </div>
          </div>
        </div>
      </div>

      {/* Mining Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        {/* Pool Mining Card */}
        <div className="card card-dark" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729',
          overflow: 'hidden'
        }}>
          <div className="card-header p-3" style={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            background: 'linear-gradient(135deg, #282729 0%, #222123 100%)',
            borderRadius: '12px 12px 0 0'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h6 className="mb-0 text-white" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                Pool Mining
              </h6>
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{
                  background: 'rgba(255, 192, 251, 0.15)',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  color: 'rgb(255 192 251)',
                  fontSize: '0.8rem',
                  fontWeight: 700
                }}>
                  {formatHashRate(totalPoolHashRate)}
                </span>
                <span style={{
                  background: 'rgba(255, 192, 251, 0.1)',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  color: 'rgb(255 192 251)',
                  fontSize: '0.8rem',
                  fontWeight: 700
                }}>
                  {poolStats?.network?.hashRate ? (totalPoolHashRate / poolStats.network.hashRate * 100).toFixed(1) : '0.0'}%
                </span>
              </div>
            </div>
          </div>
          <div className="card-body" style={{ padding: '16px 0' }}>

            {/* Pool Hashrate Chart */}
            {apiData?.charts?.hashrate && apiData.charts.hashrate.length > 0 && (
              <div style={{ marginBottom: '12px', height: '100px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={apiData.charts.hashrate.slice(-24).map(point => ({
                    time: new Date(point[0] * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
                    hashrate: point[1] || 0
                  }))}>
                    <defs>
                      <linearGradient id="poolChartGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="rgb(255 192 251)" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="rgb(255 192 251)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#282729',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        color: '#fff'
                      }}
                      formatter={(value: number | undefined) => value !== undefined ? formatHashRate(value) : ''}
                      labelFormatter={(label) => label}
                    />
                    <Area
                      type="monotone"
                      dataKey="hashrate"
                      stroke="rgb(255 192 251)"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#poolChartGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', padding: '0 16px' }}>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Miners</div>
                <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff' }}>{poolStats?.miners || 0}</div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Workers</div>
                <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff' }}>{poolStats?.workers || 0}</div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 192, 251, 0.08)', borderRadius: '8px', border: '1px solid rgba(255, 192, 251, 0.15)' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Blocks</div>
                <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'rgb(255 192 251)' }}>{poolStats?.blocks?.confirmed || 0}</div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Shares</div>
                <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff' }}>{formatLargeNumber(poolStats?.totalShares || 0)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Solo Mining Card */}
        <div className="card card-dark" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729',
          overflow: 'hidden'
        }}>
          <div className="card-header p-3" style={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            background: 'linear-gradient(135deg, #282729 0%, #222123 100%)',
            borderRadius: '12px 12px 0 0'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h6 className="mb-0 text-white" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                Solo Mining
              </h6>
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{
                  background: 'rgba(255 200, 200, 0.15)',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  color: 'rgb(255 200, 200)',
                  fontSize: '0.8rem',
                  fontWeight: 700
                }}>
                  {formatHashRate(totalSoloHashRate)}
                </span>
                <span style={{
                  background: 'rgba(255 200, 200, 0.1)',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  color: 'rgb(255 200, 200)',
                  fontSize: '0.8rem',
                  fontWeight: 700
                }}>
                  {poolStats?.network?.hashRate ? (totalSoloHashRate / poolStats.network.hashRate * 100).toFixed(1) : '0.0'}%
                </span>
              </div>
            </div>
          </div>
          <div className="card-body" style={{ padding: '16px 0' }}>

            {/* Solo Hashrate Chart */}
            {apiData?.charts?.hashrateSolo && apiData.charts.hashrateSolo.length > 0 && (
              <div style={{ marginBottom: '12px', height: '100px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={apiData.charts.hashrateSolo.slice(-24).map(point => ({
                    time: new Date(point[0] * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
                    hashrate: point[1] || 0
                  }))}>
                    <defs>
                      <linearGradient id="soloChartGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="rgb(255 200, 200)" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="rgb(255 200, 200)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#282729',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        color: '#fff'
                      }}
                      formatter={(value: number | undefined) => value !== undefined ? formatHashRate(value) : ''}
                      labelFormatter={(label) => label}
                    />
                    <Area
                      type="monotone"
                      dataKey="hashrate"
                      stroke="rgb(255 200, 200)"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#soloChartGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', padding: '0 16px' }}>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Miners</div>
                <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff' }}>{apiData?.pool.minersSolo || 0}</div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Workers</div>
                <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff' }}>{apiData?.pool.workersSolo || 0}</div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 200, 200, 0.08)', borderRadius: '8px', border: '1px solid rgba(255, 200, 200, 0.15)' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Blocks</div>
                <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'rgb(255 200, 200)' }}>{apiData?.pool.totalBlocksSolo || 0}</div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Shares</div>
                <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff' }}>{formatLargeNumber(Math.round((apiData?.pool.totalSharesSolo || 0) / 1000))}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Last Block Info & Network Statistics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        {/* Last Block Found */}
        {apiData?.lastblock && (
          <div className="card card-dark" style={{
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '12px',
            background: '#282729'
          }}>
            <div className="card-header p-3" style={{
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              background: 'linear-gradient(135deg, #282729 0%, #222123 100%)',
              borderRadius: '12px 12px 0 0'
            }}>
              <h6 className="mb-0 text-white" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                Last Block Found
              </h6>
            </div>
            <div className="card-body" style={{ padding: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                  <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Height</div>
                  <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff' }}>
                    <a
                      href={`${config.block_url}${apiData.lastblock.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'rgb(255 192 251)', textDecoration: 'underline dotted', textDecorationColor: 'rgba(255, 192, 251, 0.5)', transition: 'all 0.2s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.textDecorationColor = 'rgb(255 192 251)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.textDecorationColor = 'rgba(255, 192, 251, 0.5)'; }}
                    >
                      #{apiData.lastblock.height}
                    </a>
                  </div>
                </div>
                <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 192, 251, 0.08)', borderRadius: '8px', border: '1px solid rgba(255, 192, 251, 0.15)' }}>
                  <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Reward</div>
                  <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'rgb(255 192 251)' }}>{formatAmount(apiData.lastblock.reward)} {poolConfig?.ticker || 'PAS'}</div>
                </div>
                <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                  <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Difficulty</div>
                  <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff' }}>{formatLargeNumber(apiData.lastblock.difficulty)}</div>
                </div>
                <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                  <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Time</div>
                  <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff' }}>{moment.unix(apiData.lastblock.timestamp).fromNow()}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Network Statistics */}
        <div className="card card-dark" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729'
        }}>
          <div className="card-header p-3" style={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            background: 'linear-gradient(135deg, #282729 0%, #222123 100%)',
            borderRadius: '12px 12px 0 0'
          }}>
            <h6 className="mb-0 text-white" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
              Network Statistics
            </h6>
          </div>
          <div className="card-body" style={{ padding: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 200, 200, 0.08)', borderRadius: '8px', border: '1px solid rgba(255, 200, 200, 0.15)' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Hashrate</div>
                <div className="mobile-md-text" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'rgb(255, 200, 200)' }}>{poolStats?.network ? formatHashRate(poolStats.network.hashRate || 0) : '-'}</div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Difficulty</div>
                <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff' }}>{poolStats?.network?.difficulty ? formatLargeNumber(poolStats.network.difficulty) : '-'}</div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Height</div>
                <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff' }}>
                  {poolStats?.network?.height ? (
                    <a
                      href={`${config.block_url}${poolStats.network.height}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'rgb(255 192 251)', textDecoration: 'underline dotted', textDecorationColor: 'rgba(255, 192, 251, 0.5)', transition: 'all 0.2s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.textDecorationColor = 'rgb(255 192 251)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.textDecorationColor = 'rgba(255, 192, 251, 0.5)'; }}
                    >
                      #{poolStats.network.height}
                    </a>
                  ) : '-'}
                </div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Last Block</div>
                <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff' }}>
                  {recentBlocks.length > 0 && recentBlocks[0].timestamp > 0
                    ? moment.unix(recentBlocks[0].timestamp).fromNow()
                    : '-'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pool Information & Profitability Calculator */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        {/* Pool Information */}
        <div className="card card-dark" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729'
        }}>
          <div className="card-header p-3" style={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            background: 'linear-gradient(135deg, #282729 0%, #222123 100%)',
            borderRadius: '12px 12px 0 0'
          }}>
            <h6 className="mb-0 text-white" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
              Pool Information
            </h6>
          </div>
          <div className="card-body" style={{ padding: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 192, 251, 0.08)', borderRadius: '8px', border: '1px solid rgba(255, 192, 251, 0.15)' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Pool Fee</div>
                <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'rgb(255, 192, 251)' }}>
                  {apiData?.config.fee ? `${apiData.config.fee}%` : '-'}
                </div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 200, 200, 0.08)', borderRadius: '8px', border: '1px solid rgba(255, 200, 200, 0.15)' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Solo Fee</div>
                <div className="mobile-md-text" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'rgb(255, 200, 200)' }}>
                  {apiData?.config.soloFee ? `${apiData.config.soloFee}%` : '-'}
                </div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Min Payout</div>
                <div className="mobile-md-text" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ffffff' }}>
                  {poolConfig ? `${poolConfig.minPayout} ${poolConfig.ticker || 'PAS'}` : '-'}
                </div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Payout Interval</div>
                <div className="mobile-md-text" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ffffff' }}>
                  {poolConfig ? `${poolConfig.payoutInterval / 60} min` : '-'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Profitability Calculator */}
        <div className="card card-dark" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729'
        }}>
          <div className="card-header p-3" style={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            background: 'linear-gradient(135deg, #282729 0%, #222123 100%)',
            borderRadius: '12px 12px 0 0'
          }}>
            <h6 className="mb-0 text-white" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
              Profitability Calculator
            </h6>
          </div>
          <div className="card-body" style={{ padding: '16px' }}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '8px', fontWeight: 500 }}>
                Your Hash Rate
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="number"
                  value={calculatorHashRateValue}
                  onChange={(e) => setCalculatorHashRateValue(e.target.value)}
                  placeholder="100"
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '0.9rem',
                    outline: 'none',
                    transition: 'all 0.2s'
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 192, 251, 0.5)'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
                />
                <select
                  value={calculatorHashRateUnit}
                  onChange={(e) => setCalculatorHashRateUnit(e.target.value)}
                  style={{
                    padding: '10px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '0.9rem',
                    outline: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    minWidth: '80px'
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 192, 251, 0.5)'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
                >
                  <option value="H/s" style={{ background: '#282729' }}>H/s</option>
                  <option value="KH/s" style={{ background: '#282729' }}>KH/s</option>
                  <option value="MH/s" style={{ background: '#282729' }}>MH/s</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase' }}>Daily</div>
                <div className="mobile-md-text" style={{ fontSize: '1rem', fontWeight: 700, color: '#ffffff' }}>
                  {calculatorHashRateValue ? (
                    calculateProfitability(parseHashRateInput(calculatorHashRateValue, calculatorHashRateUnit)).daily.toFixed(4)
                  ) : '-'} {poolConfig?.ticker || 'PAS'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, textTransform: 'uppercase' }}>Monthly</div>
                <div className="mobile-md-text" style={{ fontSize: '1rem', fontWeight: 700, color: '#ffffff' }}>
                  {calculatorHashRateValue ? (
                    calculateProfitability(parseHashRateInput(calculatorHashRateValue, calculatorHashRateUnit)).monthly.toFixed(4)
                  ) : '-'} {poolConfig?.ticker || 'PAS'}
                </div>
              </div>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.4)', marginTop: '12px', textAlign: 'center' }}>
              * Estimates based on current network conditions
            </div>
          </div>
        </div>
      </div>

      {/* Recent Blocks & Payments */}
      <div style={{ marginBottom: '30px', width: '100%' }}>
        {/* Recent Blocks */}
        <div className="card card-dark" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729',
          width: '100%',
          marginBottom: '20px'
        }}>
          <div className="card-header p-3" style={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            background: 'linear-gradient(135deg, #282729 0%, #222123 100%)',
            borderRadius: '12px 12px 0 0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h6 className="mb-0 text-white" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
              Recent Blocks
            </h6>
            <span style={{
              background: 'rgba(255, 192, 251, 0.1)',
              padding: '4px 10px',
              borderRadius: '6px',
              color: 'rgb(255 192 251)',
              fontSize: '0.75rem',
              fontWeight: 600
            }}>
              {recentBlocks.length} Total
            </span>
          </div>
          <div className="card-body" style={{ padding: 0, background: '#282729', display: 'flex', flexDirection: 'column', maxHeight: '300px' }}>
            {recentBlocks.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
                No blocks found yet
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table mb-0" style={{ color: 'rgba(255, 255, 255, 0.7)', marginBottom: 0, width: '100%', flexShrink: 0, tableLayout: 'auto' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, background: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>Block</th>
                      <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, background: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>Type</th>
                      <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, background: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>Status</th>
                      <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, background: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>Effort</th>
                      <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, background: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>Reward</th>
                      <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, background: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>Found By</th>
                      <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap', background: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>Time</th>
                    </tr>
                  </thead>
                    <tbody>
                      {recentBlocks.slice(0, 40).map((block, index) => {
                        // Determine effort color
                        let effortColor = '#10b981'; // green - easy (< 100%)
                        let effortBg = 'rgba(16, 185, 129, 0.1)';
                        if (block.effort !== undefined) {
                          if (block.effort > 200) {
                            effortColor = '#ef4444'; // red - hard (> 200%)
                            effortBg = 'rgba(239, 68, 68, 0.1)';
                          } else if (block.effort > 100) {
                            effortColor = '#f59e0b'; // orange - normal (100-200%)
                            effortBg = 'rgba(245, 158, 11, 0.1)';
                          }
                        }

                        // Determine reward color - gray for pending
                        const isPending = !block.reward || block.reward === 0 || block.status === 'pending';
                        const rewardColor = isPending ? 'rgba(255, 255, 255, 0.4)' : '#10b981';

                        return (
                    <tr key={block.height || block.hash || index} style={{ borderBottom: index === 39 || index === recentBlocks.length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.03)' }}>
                      <td style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.9)', fontSize: '0.85rem', fontWeight: 600 }}>
                        {block.hash ? (
                          <a
                            href={`${config.block_url}${block.hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'rgb(255 192 251)', textDecoration: 'underline dotted', textDecorationColor: 'rgba(255, 192, 251, 0.5)', transition: 'all 0.2s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.textDecorationColor = 'rgb(255 192 251)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.textDecorationColor = 'rgba(255, 192, 251, 0.5)'; }}
                          >
                            #{block.height}
                          </a>
                        ) : (
                          <span>#{block.height}</span>
                        )}
                      </td>
                      <td style={{ padding: '14px' }}>
                        {block.type === 'solo' ? (
                          <span style={{
                            background: 'rgba(255, 200, 200, 0.1)',
                            color: 'rgb(255, 200, 200)',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            textTransform: 'uppercase'
                          }}>
                            Solo
                          </span>
                        ) : (
                          <span style={{
                            background: 'rgba(255, 192, 251, 0.1)',
                            color: 'rgb(255 192 251)',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            textTransform: 'uppercase'
                          }}>
                            Pool
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '14px' }}>
                        {block.status === 'confirmed' ? (
                          <span style={{
                            background: 'rgba(16, 185, 129, 0.1)',
                            color: '#10b981',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 600
                          }}>Confirmed</span>
                        ) : block.status === 'pending' ? (
                          <span style={{
                            background: 'rgba(245, 158, 11, 0.1)',
                            color: '#f59e0b',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            whiteSpace: 'nowrap'
                          }}>
                            <span style={{
                              display: 'inline-block',
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              border: '1.5px solid #f59e0b',
                              borderTopColor: 'transparent',
                              animation: 'spin 1s linear infinite'
                            }}></span>
                            Pending
                          </span>
                        ) : (
                          <span style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            color: '#ef4444',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 600
                          }}>Orphaned</span>
                        )}
                      </td>
                      <td style={{ padding: '14px' }}>
                        {block.effort !== undefined ? (
                          <span style={{
                            background: effortBg,
                            color: effortColor,
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 600
                          }}>
                            {block.effort.toFixed(2)}%
                          </span>
                        ) : (
                          <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '14px', color: rewardColor, fontSize: '0.85rem', fontWeight: 600 }}>
                        {block.reward && block.reward > 0 ? (
                          <span>
                            {formatAmount(block.reward)}
                            {(poolConfig?.ticker || poolConfig?.symbol) && (
                              <span style={{ color: 'rgba(255, 255, 255, 0.4)', marginLeft: '4px' }}>
                                {poolConfig.ticker || poolConfig.symbol}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>Pending</span>
                        )}
                      </td>
                      <td style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.8rem' }}>
                        {block.miner ? (
                          <Link
                            to={`/miner/${block.miner}`}
                            title={block.miner}
                            style={{ color: 'rgb(255 192 251)', textDecoration: 'underline dotted', textDecorationColor: 'rgba(255, 192, 251, 0.5)', transition: 'all 0.2s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.textDecorationColor = 'rgb(255 192 251)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.textDecorationColor = 'rgba(255, 192, 251, 0.5)'; }}
                          >
                            {`${block.miner.substring(0, 6)}...${block.miner.substring(block.miner.length - 6)}`}
                          </Link>
                        ) : (
                          <span>Unknown</span>
                        )}
                      </td>
                      <td style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        {block.timestamp > 0 ? moment.unix(block.timestamp).fromNow() : '-'}
                      </td>
                    </tr>
                      );
                    })}
                    </tbody>
                  </table>
              </div>
            )}
          </div>
        </div>

        {/* Recent Payments */}
        <div className="card card-dark" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729',
          width: '100%'
        }}>
          <div className="card-header p-3" style={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            background: 'linear-gradient(135deg, #282729 0%, #222123 100%)',
            borderRadius: '12px 12px 0 0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h6 className="mb-0 text-white" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
              Recent Payments
            </h6>
            <span style={{
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '4px 10px',
              borderRadius: '6px',
              color: '#10b981',
              fontSize: '0.75rem',
              fontWeight: 600
            }}>
              {apiData?.pool.totalPayments || 0} Total
            </span>
          </div>
          <div className="card-body" style={{ padding: 0, background: '#282729', display: 'flex', flexDirection: 'column', maxHeight: '300px' }}>
            {recentPayments.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
                No payments yet
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table mb-0" style={{ color: 'rgba(255, 255, 255, 0.7)', marginBottom: 0, width: '100%', flexShrink: 0, tableLayout: 'auto' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap', background: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>Date</th>
                      <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, background: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>Address</th>
                      <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, background: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>Amount</th>
                      <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, background: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>Fee</th>
                      <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, background: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>TX Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentPayments.slice(0, 40).map((payment, index) => (
                        <tr key={index} style={{ borderBottom: index === 39 || index === recentPayments.length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.03)' }}>
                          <td style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                            {moment.unix(payment.timestamp).format('YYYY-MM-DD HH:mm')}
                          </td>
                          <td style={{ padding: '14px', color: '#e2e8f0', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                            {payment.address ? (
                              <a
                                href={`${config.wallet_url}${payment.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={payment.address}
                                style={{ color: 'rgb(255 192 251)', textDecoration: 'underline dotted', textDecorationColor: 'rgba(255, 192, 251, 0.5)', transition: 'all 0.2s' }}
                                onMouseEnter={(e) => { e.currentTarget.style.textDecorationColor = 'rgb(255 192 251)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.textDecorationColor = 'rgba(255 192 251, 0.5)'; }}
                              >
                                {`${payment.address.substring(0, 6)}...${payment.address.substring(payment.address.length - 6)}`}
                              </a>
                            ) : payment.txHash ? (
                              <a
                                href={`${config.tx_url}${payment.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={payment.txHash}
                                style={{ color: 'rgb(255 192 251)', textDecoration: 'underline dotted', textDecorationColor: 'rgba(255, 192, 251, 0.5)', transition: 'all 0.2s' }}
                                onMouseEnter={(e) => { e.currentTarget.style.textDecorationColor = 'rgb(255 192 251)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.textDecorationColor = 'rgba(255 192 251, 0.5)'; }}
                              >
                                {`${payment.txHash.substring(0, 6)}...${payment.txHash.substring(payment.txHash.length - 6)}`}
                              </a>
                            ) : (
                              <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>Unknown</span>
                            )}
                          </td>
                          <td style={{ padding: '14px', color: '#10b981', fontSize: '0.875rem', fontWeight: 600 }}>
                            {formatAmount(payment.amount)}
                            {poolConfig && (
                              <span style={{ color: 'rgba(255, 255, 255, 0.4)', marginLeft: '4px' }}>
                                {poolConfig.symbol || poolConfig.ticker}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem' }}>
                            {formatAmount(payment.fee)}
                            {poolConfig && (
                              <span style={{ color: 'rgba(255, 255, 255, 0.4)', marginLeft: '4px' }}>
                                {poolConfig.symbol || poolConfig.ticker}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '14px', color: '#e2e8f0', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                            {payment.txHash ? (
                              <a
                                href={`${config.tx_url}${payment.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'rgb(255 192 251)', textDecoration: 'underline dotted', textDecorationColor: 'rgba(255, 192, 251, 0.5)', transition: 'all 0.2s' }}
                                onMouseEnter={(e) => { e.currentTarget.style.textDecorationColor = 'rgb(255 192 251)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.textDecorationColor = 'rgba(255 192 251, 0.5)'; }}
                              >
                                {payment.txHash.substring(0, 16)}...
                              </a>
                            ) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Top Miners */}
      <div className="card card-dark" style={{
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '12px',
        background: '#282729',
        marginBottom: '30px'
      }}>
        <div className="card-header p-3" style={{
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          background: 'linear-gradient(135deg, #282729 0%, #222123 100%)',
          borderRadius: '12px 12px 0 0'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h6 className="mb-0 text-white" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
              Top Miners
            </h6>
            <Link to="/top" style={{ color: '#FF8AFB', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 600 }}>
              View All →
            </Link>
          </div>
        </div>
        <div className="card-body p-0">
          {topMiners.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
              No miners yet
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table mb-0" style={{ color: 'rgba(255, 255, 255, 0.7)', marginBottom: 0, width: '100%', tableLayout: 'auto' }}>
                <tbody>
                  {topMiners.slice(0, 10).map((miner, index) => (
                  <tr
                    key={index}
                    style={{
                      borderBottom: index === topMiners.length - 1 || index === 9 ? 'none' : '1px solid rgba(255, 255, 255, 0.03)',
                      cursor: 'pointer',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                    onClick={() => window.location.href = `/miner/${miner.address}`}
                  >
                    <td style={{ padding: '16px', width: '50px' }}>
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: index < 3
                          ? 'rgba(255, 192, 251, 0.2)'
                          : 'rgba(255, 255, 255, 0.05)',
                        color: 'rgb(255 192 251)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.875rem',
                        border: index < 3 ? '2px solid rgb(255 192 251)' : 'none'
                      }}>
                        {index + 1}
                      </div>
                    </td>
                    <td style={{ padding: '16px', maxWidth: '400px' }}>
                      <div style={{
                        color: '#e2e8f0',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        wordBreak: 'break-all',
                        display: 'block'
                      }}>
                        {miner.address}
                      </div>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '40px' }}>
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          gap: '4px'
                        }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '0.75rem',
                            color: miner.isActive ? '#10b981' : 'rgba(255, 255, 255, 0.4)'
                          }}>
                            <span style={{
                              display: 'inline-block',
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: miner.isActive ? '#10b981' : 'rgba(255, 255, 255, 0.3)',
                              animation: miner.isActive ? 'pulse 2s ease-in-out infinite' : 'none'
                            }}></span>
                            {miner.isActive ? 'Mining' : 'Inactive'}
                          </div>
                          <div style={{
                            fontSize: '0.7rem',
                            color: 'rgba(255, 255, 255, 0.5)'
                          }}>
                            {miner.lastShare ? moment.unix(parseInt(miner.lastShare)).fromNow() : 'N/A'}
                          </div>
                        </div>
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          gap: '2px',
                          minWidth: '120px'
                        }}>
                          <div style={{
                            color: '#10b981',
                            fontSize: '0.95rem',
                            fontWeight: 600,
                            textAlign: 'right'
                          }}>
                            {formatHashRate(miner.hashRate)}
                          </div>
                          <div style={{
                            fontSize: '0.7rem',
                            color: 'rgba(255, 255, 255, 0.5)',
                            textAlign: 'right'
                          }}>
                            {formatHashes(miner.hashes)}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="footer">
        <div style={{ marginBottom: '10px' }}>
          <span style={{ color: 'rgb(255 192 251)', fontWeight: 700 }}>Pastella</span> Mining Pool
        </div>
        <div className="update-time">
          Last update: {lastUpdate ? moment(lastUpdate).format('MMMM Do YYYY, h:mm:ss A') : '-'}
        </div>
        <div style={{ marginTop: '10px', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.3)' }}>
          Powered by Cryptonote Node.js Pool • {poolConfig?.algorithm || 'RandomX'} Algorithm
        </div>
      </div>

      <style>{`
        .label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.5);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }
        .value {
          font-size: 1.5rem;
          font-weight: 700;
          color: #ffffff;
        }
        .badge-success {
          background: rgba(16, 185, 129, 0.1);
          color: #10b981;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
        }
        .badge-pending {
          background: rgba(245, 158, 11, 0.1);
          color: #f59e0b;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
        }
        .spinner-sm {
          display: inline-block;
          width: 12px;
          height: 12px;
          border: 2px solid rgba(245, 158, 11, 0.3);
          border-top-color: #f59e0b;
          border-radius: 50%;
          animation: spin-pending 1s linear infinite;
        }
        @keyframes spin-pending {
          to { transform: rotate(360deg); }
        }
        .badge-orphaned {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
        }
        .footer {
          margin-top: 60px;
          padding: 40px 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          text-align: center;
          color: rgba(255, 255, 255, 0.4);
          font-size: 0.875rem;
        }
        .update-time {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.3);
          font-weight: 500;
        }
      `}</style>
    </div>
  );
};

export default Dashboard;
