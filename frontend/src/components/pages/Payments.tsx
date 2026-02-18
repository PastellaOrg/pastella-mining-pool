import React, { useState, useEffect } from 'react';
import apiService from '../../services/api';
import moment from 'moment';
import config from '../../config/pool';
import type { PoolConfig, Payment } from '../../types';

const Payments: React.FC = () => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [poolConfig, setPoolConfig] = useState<PoolConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPayments, setTotalPayments] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const itemsPerPage = 20;

  const formatAmount = (amount: number): string => {
    if (!poolConfig) return '0';
    // Use coinDecimalPlaces if available, otherwise decimals, otherwise default to 8
    const decimals = poolConfig.coinDecimalPlaces || poolConfig.decimals || 8;
    return (amount / Math.pow(10, decimals)).toFixed(decimals);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const fetchPayments = async () => {
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

        const data = await apiService.getPayments(currentPage, itemsPerPage);
        setPayments(data.payments || []);

        // Use pagination data from backend
        setTotalPayments(data.total || 0);
        setTotalPages(data.totalPages || 0);

        setLoading(false);
      } catch (error) {
        console.error('Error fetching payments:', error);
        setLoading(false);
      }
    };

    fetchPayments();
  }, [currentPage]);

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
        Pool Payments
      </h1>

      {payments.length === 0 ? (
        <div className="card card-dark" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729'
        }}>
          <div className="card-body" style={{ padding: '60px 20px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
            No payments yet
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
              <col style={{ width: '18%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '25%' }} />
            </colgroup>
            <thead>
              <tr style={{ background: 'rgba(0, 0, 0, 0.25)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Date</th>
                <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600 }}>Address</th>
                <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600 }}>Amount</th>
                <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600 }}>Fee</th>
                <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600 }}>TX Hash</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment, index) => (
                <tr key={index} style={{ borderBottom: index === payments.length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.03)' }}>
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
                Showing {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, totalPayments)} of {totalPayments} payments
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

                {/* Page Numbers */}
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

export default Payments;
