import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import apiService from '../../services/api';
import moment from 'moment';
import config from '../../config/pool';
import type { PoolConfig, Block, ApiBlock } from '../../types';

const Blocks: React.FC = () => {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [poolConfig, setPoolConfig] = useState<PoolConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalBlocks, setTotalBlocks] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const itemsPerPage = 20;

  const formatAmount = (amount: number): string => {
    if (!poolConfig || amount === undefined || amount === null) return '0';
    if (amount === 0) return '0';
    const decimals = poolConfig.decimals ?? poolConfig.coinDecimalPlaces ?? 12;
    return (amount / Math.pow(10, decimals)).toFixed(decimals);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const fetchBlocks = async () => {
      try {
        setLoading(true);

        // Get pool config
        try {
          const poolStats = await apiService.getPoolStats();
          if (poolStats.config) {
            setPoolConfig(poolStats.config);
          }
        } catch (e) {
          console.error('Error fetching pool config:', e);
        }

        // Fetch blocks with pagination (no height parameter needed)
        const data = await apiService.getBlocks(undefined, currentPage, itemsPerPage);

        // Check if response is an error
        if ('error' in data) {
          console.error('API returned error:', data.error);
          setLoading(false);
          return;
        }

        // Parse the blocks from the response
        if ('blocks' in data && Array.isArray(data.blocks)) {
          const parsedBlocks: Block[] = [];

          // API now returns structured objects directly from backend
          for (const blockData of data.blocks) {
            // Check if it's already a structured object (new format)
            const apiBlock = blockData as ApiBlock;
            if (typeof blockData === 'object' && 'height' in apiBlock) {
              parsedBlocks.push({
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
            // Legacy format: alternating array of [blockString, height, blockString, height, ...]
            else if (typeof blockData === 'string' || typeof blockData === 'number') {
              // This is the old format - skip it or handle it if needed
              // For now, we expect the new structured format from the backend
              console.log('Legacy block format detected, skipping:', blockData);
            }
          }

          setBlocks(parsedBlocks);

          // Update pagination info from API
          if ('total' in data) {
            setTotalBlocks(data.total);
          }
          if ('totalPages' in data) {
            setTotalPages(data.totalPages);
          }
        }

        setLoading(false);
      } catch (error) {
        console.error('Error fetching blocks:', error);
        setLoading(false);
      }
    };

    fetchBlocks();
  }, [currentPage]); // Refetch when page changes

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
        Mined Blocks
      </h1>

      {blocks.length === 0 ? (
        <div className="card card-dark" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729'
        }}>
          <div className="card-body" style={{ padding: '60px 20px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
            No blocks found yet
          </div>
        </div>
      ) : (
        <div className="card card-dark" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729',
          overflow: 'hidden'
        }}>
          <div className="table-responsive">
            <table className="table mb-0" style={{ color: 'rgba(255, 255, 255, 0.7)', marginBottom: 0, width: '100%', tableLayout: 'auto' }}>
            <colgroup>
              <col style={{ width: '9%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead>
              <tr style={{ background: 'rgba(0, 0, 0, 0.25)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600 }}>Block</th>
                <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600 }}>Type</th>
                <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600 }}>Effort</th>
                <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600 }}>Reward</th>
                <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600 }}>Found By</th>
                <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((block, index) => {
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
                  <tr key={block.height || block.hash || index} style={{ borderBottom: index === blocks.length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.03)' }}>
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mobile-pagination-center" style={{
              padding: '20px',
              borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <div className="mobile-sm-text" style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.875rem' }}>
                Showing {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, totalBlocks)} of {totalBlocks} blocks
              </div>

              <div className="mobile-pagination-center" style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* First Page - hide on mobile */}
                <button
                  onClick={() => handlePageChange(1)}
                  disabled={currentPage === 1}
                  className="hide-mobile"
                  style={{
                    padding: '8px 12px',
                    background: currentPage === 1 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 192, 251, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    color: currentPage === 1 ? 'rgba(255, 255, 255, 0.3)' : 'rgb(255 192 251)',
                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (currentPage !== 1) {
                      e.currentTarget.style.background = 'rgba(255, 192, 251, 0.2)';
                      e.currentTarget.style.borderColor = 'rgba(255, 192, 251, 0.3)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentPage !== 1) {
                      e.currentTarget.style.background = 'rgba(255, 192, 251, 0.1)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    }
                  }}
                >
                  First
                </button>

                {/* Previous */}
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="mobile-pagination-btn"
                  style={{
                    padding: '8px 12px',
                    background: currentPage === 1 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 192, 251, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    color: currentPage === 1 ? 'rgba(255, 255, 255, 0.3)' : 'rgb(255 192 251)',
                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (currentPage !== 1) {
                      e.currentTarget.style.background = 'rgba(255, 192, 251, 0.2)';
                      e.currentTarget.style.borderColor = 'rgba(255, 192, 251, 0.3)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentPage !== 1) {
                      e.currentTarget.style.background = 'rgba(255, 192, 251, 0.1)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    }
                  }}
                >
                  ‹
                </button>

                {/* Page Numbers - show fewer on mobile */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className="mobile-pagination-btn"
                        style={{
                          padding: '8px 12px',
                          background: currentPage === pageNum ? 'rgb(255 192 251)' : 'rgba(255, 255, 255, 0.05)',
                          border: currentPage === pageNum ? '1px solid rgb(255 192 251)' : '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '6px',
                          color: currentPage === pageNum ? '#000' : 'rgba(255, 255, 255, 0.8)',
                          cursor: 'pointer',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          if (currentPage !== pageNum) {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (currentPage !== pageNum) {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                          }
                        }}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                {/* Next */}
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="mobile-pagination-btn"
                  style={{
                    padding: '8px 12px',
                    background: currentPage === totalPages ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 192, 251, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    color: currentPage === totalPages ? 'rgba(255, 255, 255, 0.3)' : 'rgb(255 192 251)',
                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (currentPage !== totalPages) {
                      e.currentTarget.style.background = 'rgba(255, 192, 251, 0.2)';
                      e.currentTarget.style.borderColor = 'rgba(255, 192, 251, 0.3)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentPage !== totalPages) {
                      e.currentTarget.style.background = 'rgba(255, 192, 251, 0.1)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    }
                  }}
                >
                  ›
                </button>

                {/* Last Page - hide on mobile */}
                <button
                  onClick={() => handlePageChange(totalPages)}
                  disabled={currentPage === totalPages}
                  className="hide-mobile"
                  style={{
                    padding: '8px 12px',
                    background: currentPage === totalPages ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 192, 251, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    color: currentPage === totalPages ? 'rgba(255, 255, 255, 0.3)' : 'rgb(255 192 251)',
                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (currentPage !== totalPages) {
                      e.currentTarget.style.background = 'rgba(255, 192, 251, 0.2)';
                      e.currentTarget.style.borderColor = 'rgba(255, 192, 251, 0.3)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentPage !== totalPages) {
                      e.currentTarget.style.background = 'rgba(255, 192, 251, 0.1)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    }
                  }}
                >
                  Last
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Blocks;
