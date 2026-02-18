import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AreaChart, Area, Tooltip, ResponsiveContainer, XAxis, YAxis, CartesianGrid } from 'recharts';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClock } from '@fortawesome/free-solid-svg-icons';
import apiService from '../../services/api';
import moment from 'moment';
import config from '../../config/pool';
import type { PoolConfig, MinerStats, Payment, WorkerStats, MinerBlock } from '../../types';

const Miner: React.FC = () => {
  const { address } = useParams<{ address: string }>();
  const [minerStats, setMinerStats] = useState<MinerStats | null>(null);
  const [workers, setWorkers] = useState<WorkerStats[]>([]);
  const [blocks, setBlocks] = useState<MinerBlock[]>([]);
  const [poolConfig, setPoolConfig] = useState<PoolConfig | null>(null);
  const [coinDecimals, setCoinDecimals] = useState<number>(6); // Default fallback
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<'blocks' | 'payments'>('blocks');
  const [currentTime, setCurrentTime] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [chartsData, setChartsData] = useState<Record<string, unknown> | null>(null);

  const formatHashRate = (hashRate: number | undefined): string => {
    if (!hashRate || hashRate === 0) return '0 H/s';
    if (hashRate >= 1000000000000000) return `${(hashRate / 1000000000000000).toFixed(2)} PH/s`;
    if (hashRate >= 1000000000000) return `${(hashRate / 1000000000000).toFixed(2)} TH/s`;
    if (hashRate >= 1000000000) return `${(hashRate / 1000000000).toFixed(2)} GH/s`;
    if (hashRate >= 1000000) return `${(hashRate / 1000000).toFixed(2)} MH/s`;
    if (hashRate >= 1000) return `${(hashRate / 1000).toFixed(2)} KH/s`;
    return `${hashRate.toFixed(2)} H/s`;
  };

  const formatLargeNumber = (num: number | string | undefined): string => {
    if (!num) return '0';
    const value = typeof num === 'string' ? parseInt(num) : num;
    if (value >= 1e24) return `${(value / 1e24).toFixed(2)} Y`;
    if (value >= 1e21) return `${(value / 1e21).toFixed(2)} Z`;
    if (value >= 1e18) return `${(value / 1e18).toFixed(2)} E`;
    if (value >= 1e15) return `${(value / 1e15).toFixed(2)} P`;
    if (value >= 1e12) return `${(value / 1e12).toFixed(2)} T`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)} G`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)} M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(2)} K`;
    return value.toString();
  };

  const formatAmount = (amount: number | string | undefined): string => {
    if (amount === undefined || amount === null) return '0';
    const value = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(value)) return '0';
    return (value / Math.pow(10, coinDecimals)).toFixed(coinDecimals);
  };

  useEffect(() => {
    if (!address) return;

    const fetchMinerData = async () => {
      try {
        setLoading(true);

        // First get pool stats to get config
        try {
          const poolStats = await apiService.getPoolStats();
          if (poolStats.config) {
            setPoolConfig(poolStats.config);
            // Save coin decimal places globally
            if (poolStats.config.coinDecimalPlaces !== undefined) {
              setCoinDecimals(poolStats.config.coinDecimalPlaces);
            }
          }
        } catch (e) {
          console.error('Error fetching pool config:', e);
        }

        const response = await apiService.getMinerStats(address, false) as {
          stats?: MinerStats;
          workers?: WorkerStats[];
          payments?: Payment[];
          blocks?: MinerBlock[];
          charts?: Record<string, unknown>;
        } | MinerStats;

        // Type guard to check if response has 'stats' property
        if ('stats' in response && response.stats) {
          setMinerStats(response.stats);
          setWorkers(response.workers || []);
          setBlocks(response.blocks || []);
          if (response.payments) {
            setPayments(response.payments);
          }
          if (response.charts) {
            setChartsData(response.charts);
          }
        } else {
          // Response is directly MinerStats
          setMinerStats(response as MinerStats);
          setWorkers([]);
          setBlocks([]);
          setPayments([]);
          setChartsData({});
        }
        setLastUpdate(new Date());
        setLoading(false);
      } catch (error) {
        console.error('Error fetching miner stats:', error);
        setLoading(false);
      }
    };

    fetchMinerData();

    // Set up polling for live stats
    const pollInterval = setInterval(async () => {
      try {
        const response = await apiService.getMinerStats(address, false) as {
          stats?: MinerStats;
          workers?: WorkerStats[];
          payments?: Payment[];
          blocks?: MinerBlock[];
          charts?: Record<string, unknown>;
        } | MinerStats;

        // Type guard to check if response has 'stats' property
        if ('stats' in response && response.stats) {
          setMinerStats(response.stats);
          setWorkers(response.workers || []);
          setBlocks(response.blocks || []);
          if (response.payments) {
            setPayments(response.payments);
          }
          if (response.charts) {
            setChartsData(response.charts);
          }
        } else {
          // Response is directly MinerStats
          setMinerStats(response as MinerStats);
          setWorkers([]);
          setBlocks([]);
          setPayments([]);
          setChartsData({});
        }
        setLastUpdate(new Date());
      } catch (error) {
        console.error('Error polling miner stats:', error);
      }
    }, 5000); // Poll every 5 seconds

    return () => {
      clearInterval(pollInterval);
    };
  }, [address]);

  // Update current time every second for "is mining" status
  useEffect(() => {
    const timeInterval = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => {
      clearInterval(timeInterval);
    };
  }, []);

  if (!address) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
        No address provided
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-5">
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

  if (!minerStats) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
        Miner not found. Check the address and try again.
      </div>
    );
  }

  // Access stats from the API response structure
  const stats = minerStats as unknown as Record<string, unknown>;

  return (
    <div>
      {/* Header */}
      <div className="card" style={{
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '12px',
        background: '#282729',
        marginBottom: '30px',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '30px',
          background: 'linear-gradient(135deg, rgba(255, 192, 251, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%)'
        }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ffffff', margin: '0 0 8px 0' }}>
            Miner Statistics
          </h1>
          <p style={{ color: 'rgba(255, 255, 255, 0.5)', margin: 0, fontSize: '0.875rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {address}
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="miner-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        <div className="stat-card pair-half">
          <div className="label">Current Hashrate</div>
          <div className="value accent">{formatHashRate(stats.hashrate as number | undefined)}</div>
        </div>
        <div className="stat-card pair-half">
          <div className="label">Average (1h)</div>
          <div className="value">{formatHashRate(stats.hashrate_1h as number | undefined)}</div>
        </div>
        <div className="stat-card pair-half">
          <div className="label">Average (6h)</div>
          <div className="value">{formatHashRate(stats.hashrate_6h as number | undefined)}</div>
        </div>
        <div className="stat-card pair-half">
          <div className="label">Average (24h)</div>
          <div className="value">{formatHashRate(stats.hashrate_24h as number | undefined)}</div>
        </div>
        <div className="stat-card pair-half">
          <div className="label">Total Hashes</div>
          <div className="value">{formatLargeNumber(stats.hashes as number | undefined)}</div>
        </div>
        <div className="stat-card pair-half">
          <div className="label">Round Hashes</div>
          {stats.roundSharePercent !== undefined && stats.roundSharePercent !== null ? (
            <>
              <div className="value accent">
                {typeof stats.roundSharePercent === 'number'
                  ? `${(stats.roundSharePercent as number).toFixed(4)}%`
                  : `${stats.roundSharePercent}%`
                }
              </div>
              <div style={{ fontSize: '0.875rem', color: 'rgba(255, 255, 255, 0.5)', marginTop: '2px' }}>
                {formatLargeNumber(stats.roundHashes as number | undefined)}
              </div>
            </>
          ) : (
            <div className="value">{formatLargeNumber(stats.roundHashes as number | undefined)}</div>
          )}
        </div>
        <div className="stat-card full-width-mobile">
          <div className="label">Balance</div>
          <div className="value accent">
            {formatAmount(stats.balance as number | undefined)}
            {(poolConfig?.ticker || poolConfig?.symbol) && (
              <span style={{ color: 'rgba(255, 255, 255, 0.4)', marginLeft: '4px' }}>
                {poolConfig.ticker || poolConfig.symbol}
              </span>
            )}
          </div>
        </div>
        <div className="stat-card full-width-mobile">
          <div className="label">Paid Balance</div>
          <div className="value highlight">
            {formatAmount(stats.paid as number | undefined)}
            {(poolConfig?.ticker || poolConfig?.symbol) && (
              <span style={{ color: 'rgba(255, 255, 255, 0.4)', marginLeft: '4px' }}>
                {poolConfig.ticker || poolConfig.symbol}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Hashrate Chart */}
      {chartsData && chartsData.hashrate && Array.isArray(chartsData.hashrate) && chartsData.hashrate.length >= 2 ? (
        <div className="card" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729',
          marginBottom: '30px',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '20px 20px 16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
          }}>
            <h6 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#ffffff', margin: 0 }}>
              Hashrate History (Last 24 Hours)
            </h6>
          </div>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={(chartsData.hashrate as Array<[number, number]>).slice(-96).map(point => ({
                time: new Date(point[0] * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
                hashrate: point[1] || 0
              }))} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="minerChartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgb(255 192 251)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="rgb(255 192 251)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                <XAxis
                  dataKey="time"
                  stroke="rgba(255, 255, 255, 0.3)"
                  style={{ fontSize: '0.7rem', fill: 'rgba(255, 255, 255, 0.5)' }}
                  tick={{ fill: 'rgba(255, 255, 255, 0.5)' }}
                />
                <YAxis
                  stroke="rgba(255, 255, 255, 0.3)"
                  style={{ fontSize: '0.7rem', fill: 'rgba(255, 255, 255, 0.5)' }}
                  tick={{ fill: 'rgba(255, 255, 255, 0.5)' }}
                  tickFormatter={(value: number | undefined) => value !== undefined ? formatHashRate(value) : ''}
                />
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
                  fill="url(#minerChartGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : chartsData && chartsData.hashrate && Array.isArray(chartsData.hashrate) && chartsData.hashrate.length > 0 ? (
        <div className="card" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729',
          marginBottom: '30px'
        }}>
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.5)'
          }}>
            <FontAwesomeIcon icon={faClock} style={{ fontSize: '1.5rem', marginBottom: '12px', color: 'rgba(255, 255, 255, 0.4)' }} />
            <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>
              Not enough data yet
            </div>
            <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>
              Keep mining to generate hashrate history
            </div>
          </div>
        </div>
      ) : null}

      {/* Workers */}
      {workers && workers.length > 0 && (
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
            <h6 className="mb-0 text-white" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
              Workers ({workers.length})
            </h6>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-scroll-container">
            <table className="table mb-0" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
              <thead>
                <tr style={{ background: 'rgba(0, 0, 0, 0.2)', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Worker</th>
                  <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Type</th>
                  <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Hashrate</th>
                  <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>1h Avg</th>
                  <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>6h Avg</th>
                  <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>24h Avg</th>
                  <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Total Hashes</th>
                  <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Last Share</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((worker, index) => {
                  const workerData = worker as unknown as Record<string, unknown>;
                  const lastShare = workerData.lastShare as number | undefined;
                  const isMining = lastShare && (currentTime - lastShare) < 300; // 5 minutes
                  const workerType = workerData.type as 'solo' | 'prop' | undefined;
                  const isSolo = workerType === 'solo';

                  return (
                    <tr key={index} style={{ borderBottom: index === workers.length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.03)' }}>
                      <td style={{ padding: '16px' }}>
                        {isMining ? (
                          <span style={{
                            display: 'inline-block',
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            background: '#10b981',
                            boxShadow: '0 0 0 0 rgba(16, 185, 129, 0.7)',
                            animation: 'pulse-green 2s infinite'
                          }}></span>
                        ) : (
                          <span style={{
                            display: 'inline-block',
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            background: '#ef4444'
                          }}></span>
                        )}
                      </td>
                      <td style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem' }}>
                        {worker.name}
                      </td>
                      <td style={{ padding: '16px' }}>
                        {workerType ? (
                          <span style={{
                            background: isSolo ? 'rgba(255, 200, 200, 0.1)' : 'rgba(255, 192, 251, 0.1)',
                            color: isSolo ? 'rgb(255, 200, 200)' : 'rgb(255 192 251)',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            textTransform: 'uppercase'
                          }}>
                            {isSolo ? 'Solo' : 'Pool'}
                          </span>
                        ) : (
                          <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '16px', color: isSolo ? 'rgb(255, 200, 200)' : 'rgb(255 192 251)', fontSize: '0.875rem', fontWeight: 600 }}>
                        {formatHashRate(workerData.hashrate as number | undefined)}
                      </td>
                      <td style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem' }}>
                        {formatHashRate(workerData.hashrate_1h as number | undefined)}
                      </td>
                      <td style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem' }}>
                        {formatHashRate(workerData.hashrate_6h as number | undefined)}
                      </td>
                      <td style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem' }}>
                        {formatHashRate(workerData.hashrate_24h as number | undefined)}
                      </td>
                      <td style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem' }}>
                        {formatLargeNumber(workerData.hashes as number | undefined)}
                      </td>
                      <td style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem' }}>
                        {lastShare ? moment.unix(lastShare).fromNow() : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {/* Blocks Found & Payments - Tabbed Card */}
      <div className="card card-dark" style={{
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '12px',
        background: '#282729',
        marginBottom: '30px'
      }}>
        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          background: 'linear-gradient(135deg, #282729 0%, #222123 100%)',
          borderRadius: '12px 12px 0 0'
        }}>
          <button
            onClick={() => setActiveTab('blocks')}
            className="mobile-tab-btn"
            style={{
              padding: '16px 24px',
              background: activeTab === 'blocks' ? 'rgba(255, 192, 251, 0.1)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'blocks' ? '2px solid rgb(255 192 251)' : '2px solid transparent',
              color: activeTab === 'blocks' ? 'rgb(255 192 251)' : 'rgba(255, 255, 255, 0.6)',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
              borderRadius: '12px 12px 0 0'
            }}
            onMouseEnter={(e) => {
              if (activeTab !== 'blocks') {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== 'blocks') {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
              }
            }}
          >
            Blocks
          </button>
          <button
            onClick={() => setActiveTab('payments')}
            className="mobile-tab-btn"
            style={{
              padding: '16px 24px',
              background: activeTab === 'payments' ? 'rgba(255, 192, 251, 0.1)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'payments' ? '2px solid rgb(255 192 251)' : '2px solid transparent',
              color: activeTab === 'payments' ? 'rgb(255 192 251)' : 'rgba(255, 255, 255, 0.6)',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
              borderRadius: '12px 12px 0 0'
            }}
            onMouseEnter={(e) => {
              if (activeTab !== 'payments') {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== 'payments') {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
              }
            }}
          >
            Payments
          </button>
        </div>

        {/* Tab Content */}
        <div style={{ padding: 0 }}>
          {activeTab === 'blocks' && (
            <div>
              {blocks.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
                  No blocks yet
                </div>
              ) : (
                <div className="table-scroll-container">
                  <table className="table mb-0" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                  <thead>
                    <tr style={{ background: 'rgba(0, 0, 0, 0.2)', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Height</th>
                      <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Type</th>
                      <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Status</th>
                      <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Block Reward</th>
                      <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Your Reward</th>
                      <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Your Share</th>
                      <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blocks.map((block, index) => (
                      <tr key={index} style={{ borderBottom: index === blocks.length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.03)' }}>
                        <td style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.9)', fontSize: '0.875rem', fontWeight: 600 }}>
                          {block.hash ? (
                            <a
                              href={`${config.block_url}${block.hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: 'rgb(255 192 251)', textDecoration: 'underline dotted', textDecorationColor: 'rgba(255, 192, 251, 0.5)', transition: 'all 0.2s' }}
                              onMouseEnter={(e) => { e.currentTarget.style.textDecorationColor = 'rgb(255 192 251)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.textDecorationColor = 'rgba(255 192 251, 0.5)'; }}
                            >
                              #{block.height}
                            </a>
                          ) : (
                            <span>#{block.height || 'N/A'}</span>
                          )}
                        </td>
                        <td style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem' }}>
                          <span style={{
                            background: block.type === 'solo'
                              ? 'rgba(255, 200, 200, 0.1)'
                              : 'rgba(255, 192, 251, 0.1)',
                            color: block.type === 'solo' ? 'rgb(255, 200, 200)' : 'rgb(255 192 251)',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            textTransform: 'uppercase'
                          }}>
                            {block.type === 'solo' ? 'Solo' : 'Pool'}
                          </span>
                        </td>
                        <td style={{ padding: '16px' }}>
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
                              fontWeight: 600
                            }}>Pending</span>
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
                        <td style={{ padding: '16px', color: '#10b981', fontSize: '0.875rem', fontWeight: 600 }}>
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
                            <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>
                              Pending
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '16px', color: '#10b981', fontSize: '0.875rem', fontWeight: 600 }}>
                          {block.type === 'solo'
                            ? block.reward && block.reward > 0
                              ? (
                                <span>
                                  {formatAmount(block.reward)}
                                  {(poolConfig?.ticker || poolConfig?.symbol) && (
                                    <span style={{ color: 'rgba(255, 255, 255, 0.4)', marginLeft: '4px' }}>
                                      {poolConfig.ticker || poolConfig.symbol}
                                    </span>
                                  )}
                                </span>
                              )
                              : (
                                <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>
                                  Pending
                                </span>
                              )
                            : block.minerReward !== undefined && block.minerReward > 0
                              ? (
                                <span>
                                  {formatAmount(block.minerReward)}
                                  {(poolConfig?.ticker || poolConfig?.symbol) && (
                                    <span style={{ color: 'rgba(255, 255, 255, 0.4)', marginLeft: '4px' }}>
                                      {poolConfig.ticker || poolConfig.symbol}
                                    </span>
                                  )}
                                </span>
                              )
                              : block.sharePercent !== undefined && block.reward && block.reward > 0
                                ? (
                                  <span>
                                    {formatAmount(block.reward * block.sharePercent / 100 * 0.99)}
                                    {(poolConfig?.ticker || poolConfig?.symbol) && (
                                      <span style={{ color: 'rgba(255, 255, 255, 0.4)', marginLeft: '4px' }}>
                                        {poolConfig.ticker || poolConfig.symbol}
                                      </span>
                                    )}
                                  </span>
                                )
                                : (
                                  <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>
                                    Pending
                                  </span>
                                )
                          }
                        </td>
                        <td style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem' }}>
                          {block.type === 'solo' ? (
                            <span style={{ color: 'rgb(255, 200, 200)', fontWeight: 600 }}>100%</span>
                          ) : block.sharePercent !== undefined ? (
                            <span style={{ color: 'rgb(255 192 251)', fontWeight: 600 }}>
                              {block.sharePercent.toFixed(6)}%
                            </span>
                          ) : (
                            <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Pool</span>
                          )}
                        </td>
                        <td style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem' }}>
                          {moment.unix(block.timestamp).fromNow()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'payments' && (
            <div>
              {payments.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
                  No payments yet
                </div>
              ) : (
                <div className="table-scroll-container">
                  <table className="table mb-0" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                  <thead>
                    <tr style={{ background: 'rgba(0, 0, 0, 0.2)', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Date</th>
                      <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Amount</th>
                      <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>Fee</th>
                      <th style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', fontWeight: 600 }}>TX Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.slice(0, 20).map((payment, index) => (
                      <tr key={index} style={{ borderBottom: index === payments.length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.03)' }}>
                        <td style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem' }}>
                          {moment.unix(payment.timestamp).format('YYYY-MM-DD HH:mm')}
                        </td>
                        <td style={{ padding: '16px', color: '#10b981', fontSize: '0.875rem', fontWeight: 600 }}>
                          <span>
                            {formatAmount(payment.amount)}
                            {(poolConfig?.ticker || poolConfig?.symbol) && (
                              <span style={{ color: 'rgba(255, 255, 255, 0.4)', marginLeft: '4px' }}>
                                {poolConfig.ticker || poolConfig.symbol}
                              </span>
                            )}
                          </span>
                        </td>
                        <td style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem' }}>
                          <span>
                            {formatAmount(payment.fee || 0)}
                            {(poolConfig?.ticker || poolConfig?.symbol) && (
                              <span style={{ color: 'rgba(255, 255, 255, 0.4)', marginLeft: '4px' }}>
                                {poolConfig.ticker || poolConfig.symbol}
                              </span>
                            )}
                          </span>
                        </td>
                        <td style={{ padding: '16px', color: '#e2e8f0', fontSize: '0.75rem', fontFamily: 'monospace' }}>
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
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="footer">
        <div className="update-time">
          Last update: {lastUpdate ? moment(lastUpdate).format('MMMM Do YYYY, h:mm:ss A') : '-'}
        </div>
      </div>

      <style>{`
        .stat-card {
          background: #282729;
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 20px;
        }
        .stat-card .label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.5);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }
        .stat-card .value {
          font-size: 1.5rem;
          font-weight: 700;
          color: #ffffff;
        }
        .stat-card .value.highlight {
          color: #10b981;
        }
        .stat-card .value.accent {
          color: rgb(255 192 251);
        }
        .footer {
          margin-top: 60px;
          padding: 30px 0;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          text-align: center;
          color: rgba(255, 255, 255, 0.3);
          font-size: 0.875rem;
        }
        .update-time {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.3);
        }
        @keyframes pulse-green {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 10px rgba(16, 185, 129, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
          }
        }
      `}</style>
    </div>
  );
};

export default Miner;
