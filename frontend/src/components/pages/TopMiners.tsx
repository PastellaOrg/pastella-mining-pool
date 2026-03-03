import React, { useState, useEffect } from 'react';
import apiService from '../../services/api';
import moment from 'moment';
import type { Miner } from '../../types';

const TopMiners: React.FC = () => {
  const [miners, setMiners] = useState<Miner[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter states
  const [sortBy, setSortBy] = useState<'hashes' | 'hashrate'>('hashrate');
  const [limit, setLimit] = useState(10);
  const [excludeInactive, setExcludeInactive] = useState(false);

  const formatHashRate = (hashRate: number | undefined): string => {
    if (!hashRate || hashRate === 0) return '0 H/s';
    if (hashRate >= 1000000000000000) return `${(hashRate / 1000000000000000).toFixed(2)} PH/s`;
    if (hashRate >= 1000000000000) return `${(hashRate / 1000000000000).toFixed(2)} TH/s`;
    if (hashRate >= 1000000000) return `${(hashRate / 1000000000).toFixed(2)} GH/s`;
    if (hashRate >= 1000000) return `${(hashRate / 1000000).toFixed(2)} MH/s`;
    if (hashRate >= 1000) return `${(hashRate / 1000).toFixed(2)} KH/s`;
    return `${hashRate.toFixed(2)} H/s`;
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

  useEffect(() => {
    const fetchTopMiners = async () => {
      try {
        setLoading(true);
        const data = await apiService.getTopMiners({
          sortBy,
          limit,
          excludeInactive,
          inactiveHours: excludeInactive ? 0.083 : 24 // 5 minutes when excluding, 24h default
        });
        const miners = data.miners || [];

        // Calculate current time once during data fetch, not during render
        const now = Math.floor(Date.now() / 1000);

        // Transform API data format
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

        setMiners(transformedMiners);
      } catch (error) {
        console.error('Error fetching top miners:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTopMiners();
  }, [sortBy, limit, excludeInactive]);

  const handleLimitChange = (value: string) => {
    setLimit(parseInt(value) || 10);
  };

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

  return (
    <div>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, color: '#ffffff', marginBottom: '30px' }}>
        Top Miners
      </h1>

      {/* Filters */}
      <div className="card card-dark mb-4" style={{
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '12px',
        background: '#282729'
      }}>
        <div className="card-body" style={{ padding: '20px' }}>
          <div className="row g-3 align-items-center">
            {/* Sort By Toggle */}
            <div className="col-md-auto">
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <span style={{
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '0.875rem',
                  fontWeight: 500
                }}>
                  Hashes
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const newSortBy = sortBy === 'hashes' ? 'hashrate' : 'hashes';
                    setSortBy(newSortBy);
                    if (newSortBy === 'hashrate') {
                      setExcludeInactive(false); // Reset when switching to hashrate
                    }
                  }}
                  style={{
                    position: 'relative',
                    width: '52px',
                    height: '28px',
                    background: sortBy === 'hashrate' ? 'rgb(255, 192, 251)' : 'rgba(255, 255, 255, 0.1)',
                    border: 'none',
                    borderRadius: '14px',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                    padding: 0
                  }}
                >
                  <span style={{
                    position: 'absolute',
                    top: '2px',
                    left: sortBy === 'hashrate' ? '26px' : '2px',
                    width: '24px',
                    height: '24px',
                    background: '#fff',
                    borderRadius: '50%',
                    transition: 'left 0.2s',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }}></span>
                </button>
                <span style={{
                  color: sortBy === 'hashrate' ? 'rgb(255, 192, 251)' : 'rgba(255, 255, 255, 0.7)',
                  fontSize: '0.875rem',
                  fontWeight: sortBy === 'hashrate' ? 600 : 500,
                  transition: 'color 0.2s'
                }}>
                  Hashrate
                </span>
              </div>
            </div>

            {/* Limit */}
            <div className="col-md-auto">
              <select
                className="form-select form-select-dark"
                style={{
                  background: '#1a1a1a',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  fontSize: '0.875rem',
                  borderRadius: '8px',
                  padding: '6px 12px',
                  cursor: 'pointer'
                }}
                value={limit}
                onChange={(e) => handleLimitChange(e.target.value)}
              >
                <option value="10">Top 10</option>
                <option value="20">Top 20</option>
                <option value="50">Top 50</option>
                <option value="100">Top 100</option>
                <option value="500">Top 500</option>
              </select>
            </div>

            {/* Exclude Inactive Toggle - only show when sorting by hashes */}
            {sortBy === 'hashes' && (
              <div className="col-md-auto">
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <span style={{
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontSize: '0.875rem',
                    fontWeight: 500
                  }}>
                    Exclude inactive
                  </span>
                  <button
                    type="button"
                    onClick={() => setExcludeInactive(!excludeInactive)}
                    style={{
                      position: 'relative',
                      width: '52px',
                      height: '28px',
                      background: excludeInactive ? 'rgb(255, 192, 251)' : 'rgba(255, 255, 255, 0.1)',
                      border: 'none',
                      borderRadius: '14px',
                      cursor: 'pointer',
                      transition: 'background 0.2s',
                      padding: 0
                    }}
                  >
                    <span style={{
                      position: 'absolute',
                      top: '2px',
                      left: excludeInactive ? '26px' : '2px',
                      width: '24px',
                      height: '24px',
                      background: '#fff',
                      borderRadius: '50%',
                      transition: 'left 0.2s',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }}></span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Miners List */}
      {miners.length === 0 ? (
        <div className="card card-dark" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729'
        }}>
          <div className="card-body" style={{ padding: '60px 20px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
            No miners found
          </div>
        </div>
      ) : (
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h6 className="mb-0 text-white" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                Top {limit} Miners by {sortBy === 'hashes' ? 'Total Hashes' : 'Hashrate'}
                {excludeInactive && ' (excluding inactive)'}
              </h6>
              <span style={{
                background: 'rgba(255, 192, 251, 0.1)',
                padding: '4px 10px',
                borderRadius: '6px',
                color: 'rgb(255, 192, 251)',
                fontSize: '0.75rem',
                fontWeight: 600
              }}>
                {miners.length} shown
              </span>
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {miners.map((miner, index) => (
              <div
                key={index}
                className="mobile-miner-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '16px',
                  borderBottom: index === miners.length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.03)',
                  transition: 'background 0.2s',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
                onClick={() => window.location.href = `/miner/${miner.address}`}
              >
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: index < 3
                    ? 'rgba(255, 192, 251, 0.2)'
                    : 'rgba(255, 255, 255, 0.05)',
                  color: 'rgb(255, 192 251)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  marginRight: '20px',
                  flexShrink: 0,
                  border: index < 3 ? '2px solid rgb(255 192 251)' : 'none'
                }}>
                  {index + 1}
                </div>
                <div style={{
                  flex: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  color: '#e2e8f0',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0
                }}>
                  {miner.address}
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '20px',
                  marginLeft: '20px',
                  flexShrink: 0
                }}>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: '4px'
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.875rem',
                      color: miner.isActive ? '#10b981' : 'rgba(255, 255, 255, 0.4)'
                    }}>
                      <span style={{
                        display: 'inline-block',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: miner.isActive ? '#10b981' : 'rgba(255, 255, 255, 0.3)',
                        animation: miner.isActive ? 'pulse 2s ease-in-out infinite' : 'none'
                      }}></span>
                      {miner.isActive ? 'Mining' : 'Inactive'}
                    </div>
                    <div style={{
                      fontSize: '0.75rem',
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
                      fontWeight: 600,
                      color: '#10b981',
                      fontSize: '1rem',
                      textAlign: 'right'
                    }}>
                      {formatHashRate(miner.hashRate)}
                    </div>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'rgba(255, 255, 255, 0.5)',
                      textAlign: 'right'
                    }}>
                      {formatHashes(miner.hashes)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TopMiners;
