import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiService from '../../services/api';
import type { AdminStats, AdminUser, AdminUsers, AdminMonitoring, AdminPorts } from '../../types';

const Admin: React.FC = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [storedPassword, setStoredPassword] = useState<string>('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<'stats' | 'users' | 'monitoring' | 'logs'>('stats');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin data
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUsers | null>(null);
  const [adminMonitoring, setAdminMonitoring] = useState<AdminMonitoring | null>(null);
  const [adminPorts, setAdminPorts] = useState<AdminPorts | null>(null);
  const [selectedLogFile, setSelectedLogFile] = useState<string>('');
  const [allLogLines, setAllLogLines] = useState<string[]>([]);
  const [displayedLogLines, setDisplayedLogLines] = useState<string[]>([]);
  const [logOffset, setLogOffset] = useState(0);
  const [hasMoreLogs, setHasMoreLogs] = useState(true);
  const [logScrollRef, setLogScrollRef] = useState<HTMLDivElement | null>(null);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<keyof AdminUser | 'address'>('address');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const fetchWithAuth = async (endpoint: string): Promise<Response> => {
    const url = `${apiService.getBaseUrl()}${endpoint}${endpoint.includes('?') ? '&' : '?'}password=${encodeURIComponent(storedPassword)}`;
    return fetch(url);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiService.getBaseUrl()}/admin_stats?password=${encodeURIComponent(password)}`);

      if (response.ok) {
        setStoredPassword(password);
        setIsAuthenticated(true);
        const data = await response.json();
        setAdminStats(data);
      } else if (response.status === 401) {
        setError('Invalid password');
      } else {
        setError('Authentication failed');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  const fetchAdminStats = async () => {
    try {
      const response = await fetchWithAuth('/admin_stats');
      if (response.ok) {
        const data = await response.json();
        setAdminStats(data);
      }
    } catch (e) {
      console.error('Error fetching admin stats:', e);
    }
  };

  const fetchAdminUsers = async () => {
    try {
      const response = await fetchWithAuth('/admin_users');
      if (response.ok) {
        const data = await response.json();
        setAdminUsers(data);
      }
    } catch (e) {
      console.error('Error fetching admin users:', e);
    }
  };

  const fetchAdminMonitoring = async () => {
    try {
      const response = await fetchWithAuth('/admin_monitoring');
      if (response.ok) {
        const data = await response.json();
        setAdminMonitoring(data);
      }
    } catch (e) {
      console.error('Error fetching admin monitoring:', e);
    }
  };

  const fetchAdminPorts = async () => {
    try {
      const response = await fetchWithAuth('/admin_ports');
      if (response.ok) {
        const data = await response.json();
        setAdminPorts(data);
      }
    } catch (e) {
      console.error('Error fetching admin ports:', e);
    }
  };

  const fetchLogFile = async (filename: string, switchToLogsTab = false) => {
    setSelectedLogFile(filename);
    setLoading(true);
    setAllLogLines([]);
    setDisplayedLogLines([]);
    setLogOffset(0);
    setHasMoreLogs(true);
    try {
      const response = await fetchWithAuth(`/admin_log?file=${encodeURIComponent(filename)}`);
      if (response.ok) {
        const text = await response.text();
        const lines = text.split('\n').filter(line => line.trim());
        setAllLogLines(lines);

        // Get last 100 lines
        const last100Lines = lines.slice(-100);
        setDisplayedLogLines(last100Lines);
        setLogOffset(Math.max(0, lines.length - 100));
        setHasMoreLogs(lines.length > 100);

        if (switchToLogsTab) {
          setActiveTab('logs');
        }

        // Always scroll to bottom after loading logs
        setTimeout(() => {
          logScrollRef?.scrollTo({ top: logScrollRef.scrollHeight, behavior: 'instant' });
        }, 100);
      } else {
        setDisplayedLogLines(['Error loading log file']);
        setHasMoreLogs(false);
      }
    } catch {
      setDisplayedLogLines(['Error loading log file']);
      setHasMoreLogs(false);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreLogs = () => {
    if (!hasMoreLogs || logOffset <= 0) return;

    const prevLineCount = Math.min(100, logOffset);
    const newOffset = Math.max(0, logOffset - prevLineCount);
    const prevLines = allLogLines.slice(newOffset, logOffset);

    setDisplayedLogLines([...prevLines, ...displayedLogLines]);
    setLogOffset(newOffset);
    setHasMoreLogs(newOffset > 0);

    // Keep scroll position
    setTimeout(() => {
      const scrollHeight = logScrollRef?.scrollHeight || 0;
      const clientHeight = logScrollRef?.clientHeight || 0;
      const targetScroll = scrollHeight - clientHeight - 100;
      logScrollRef?.scrollTo({ top: targetScroll, behavior: 'instant' });
    }, 50);
  };

  const handleLogScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    if (target.scrollTop < 50 && hasMoreLogs && !loading) {
      loadMoreLogs();
    }
  };

  useEffect(() => {
    if (!isAuthenticated || !storedPassword) return;

    switch (activeTab) {
      case 'stats':
        fetchAdminStats();
        break;
      case 'users':
        fetchAdminUsers();
        break;
      case 'monitoring':
        fetchAdminMonitoring();
        fetchAdminPorts();
        break;
      case 'logs':
        if (!adminMonitoring) {
          fetchAdminMonitoring();
        } else if (!selectedLogFile && adminMonitoring.logs && Object.keys(adminMonitoring.logs).length > 0) {
          fetchLogFile(Object.keys(adminMonitoring.logs)[0]);
        }
        break;
    }
    // Only depend on activeTab, auth state, and storedPassword
    // Fetch functions are intentionally omitted to prevent infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAuthenticated, storedPassword]);

  useEffect(() => {
    if (activeTab === 'logs' && adminMonitoring?.logs && Object.keys(adminMonitoring.logs).length > 0 && !selectedLogFile) {
      fetchLogFile(Object.keys(adminMonitoring.logs)[0]);
    }
    // fetchLogFile intentionally omitted to prevent infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, adminMonitoring, selectedLogFile]);

  const handleSort = (column: keyof AdminUser | 'address') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const getSortedUsers = () => {
    if (!adminUsers) return [];

    const entries = Object.entries(adminUsers);
    const sorted = entries.sort(([addressA, a], [addressB, b]) => {
      let comparison = 0;

      switch (sortColumn) {
        case 'address':
          comparison = addressA.localeCompare(addressB);
          break;
        case 'pending':
          comparison = parseFloat(a.pending || '0') - parseFloat(b.pending || '0');
          break;
        case 'paid':
          comparison = parseFloat(a.paid || '0') - parseFloat(b.paid || '0');
          break;
        case 'hashes':
          comparison = parseFloat(a.hashes || '0') - parseFloat(b.hashes || '0');
          break;
        case 'hashrate':
          comparison = (a.hashrate || 0) - (b.hashrate || 0);
          break;
        case 'lastShare':
          comparison = parseInt(a.lastShare || '0') - parseInt(b.lastShare || '0');
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  };

  const getSortIndicator = (column: keyof AdminUser | 'address') => {
    if (sortColumn !== column) return '';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  const formatHashRate = (hashRate: number): string => {
    if (!hashRate || hashRate === 0) return '0 H/s';
    if (hashRate >= 1e15) return `${(hashRate / 1e15).toFixed(2)} PH/s`;
    if (hashRate >= 1e12) return `${(hashRate / 1e12).toFixed(2)} TH/s`;
    if (hashRate >= 1e9) return `${(hashRate / 1e9).toFixed(2)} GH/s`;
    if (hashRate >= 1e6) return `${(hashRate / 1e6).toFixed(2)} MH/s`;
    if (hashRate >= 1e3) return `${(hashRate / 1e3).toFixed(2)} KH/s`;
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

  // Pastella uses 8 decimal places (100,000,000 atomic units = 1 PAS)
  const formatAmount = (amount: number): string => {
    if (amount === undefined || amount === null) return '0';
    if (amount === 0) return '0';
    return (amount / 100000000).toFixed(4);
  };

  // Login screen
  if (!isAuthenticated) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)'
      }}>
        <div style={{
          background: '#282729',
          padding: '40px',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          width: '100%',
          maxWidth: '400px'
        }}>
          <h2 style={{
            color: '#ffffff',
            marginBottom: '24px',
            textAlign: 'center',
            fontWeight: 600
          }}>
            Admin Panel
          </h2>
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                color: 'rgba(255, 255, 255, 0.7)',
                marginBottom: '8px',
                fontSize: '0.9rem'
              }}>
                Admin Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  color: '#ffffff',
                  fontSize: '1rem',
                  outline: 'none'
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 192, 251, 0.5)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'; }}
                autoFocus
              />
            </div>
            {error && (
              <div style={{
                color: '#ef4444',
                marginBottom: '16px',
                fontSize: '0.875rem',
                textAlign: 'center'
              }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                background: loading ? 'rgba(255, 192, 251, 0.3)' : 'rgb(255, 192, 251)',
                border: 'none',
                borderRadius: '8px',
                color: '#000000',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {loading ? 'Authenticating...' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Admin dashboard
  return (
    <div style={{ padding: '30px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '30px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ color: '#ffffff', fontSize: '1.75rem', fontWeight: 600 }}>
            Admin Dashboard
          </h1>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '8px 16px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            Back to Pool
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
        {(['stats', 'users', 'monitoring', 'logs'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 20px',
              background: activeTab === tab ? 'rgb(255, 192, 251)' : 'rgba(255, 255, 255, 0.05)',
              border: activeTab === tab ? '1px solid rgb(255, 192, 251)' : '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: activeTab === tab ? '#000000' : '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.2s',
              fontWeight: 500,
              textTransform: 'capitalize'
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ background: '#282729', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)', overflow: 'hidden' }}>
        {activeTab === 'stats' && adminStats && (
          <div style={{ padding: '24px' }}>
            <h2 style={{ color: '#ffffff', marginBottom: '20px', fontSize: '1.25rem' }}>Pool Statistics</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
              <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', marginBottom: '8px' }}>Total Owed</div>
                <div style={{ color: '#ffffff', fontSize: '1.5rem', fontWeight: 700 }}>{formatAmount(adminStats.totalOwed || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', marginBottom: '8px' }}>Total Paid</div>
                <div style={{ color: 'rgb(16, 185, 129)', fontSize: '1.5rem', fontWeight: 700 }}>{formatAmount(adminStats.totalPaid || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', marginBottom: '8px' }}>Total Revenue (Pool)</div>
                <div style={{ color: 'rgb(255, 192, 251)', fontSize: '1.5rem', fontWeight: 700 }}>{formatAmount(adminStats.totalRevenue || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', marginBottom: '8px' }}>Total Revenue (Solo)</div>
                <div style={{ color: 'rgb(255, 200, 200)', fontSize: '1.5rem', fontWeight: 700 }}>{formatAmount(adminStats.totalRevenueSolo || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', marginBottom: '8px' }}>Blocks Unlocked</div>
                <div style={{ color: '#ffffff', fontSize: '1.5rem', fontWeight: 700 }}>{adminStats.blocksUnlocked || 0}</div>
              </div>
              <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', marginBottom: '8px' }}>Blocks Orphaned</div>
                <div style={{ color: '#ef4444', fontSize: '1.5rem', fontWeight: 700 }}>{adminStats.blocksOrphaned || 0}</div>
              </div>
              <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', marginBottom: '8px' }}>Total Workers</div>
                <div style={{ color: '#ffffff', fontSize: '1.5rem', fontWeight: 700 }}>{adminStats.totalWorkers || 0}</div>
              </div>
              <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', marginBottom: '8px' }}>Total Shares</div>
                <div style={{ color: '#ffffff', fontSize: '1.5rem', fontWeight: 700 }}>{formatLargeNumber(adminStats.totalShares || 0)}</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'users' && adminUsers && (
          <div style={{ padding: '24px' }}>
            <h2 style={{ color: '#ffffff', marginBottom: '20px', fontSize: '1.25rem' }}>
              All Users ({Object.keys(adminUsers || {}).length})
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                    <th
                      onClick={() => handleSort('address')}
                      style={{ padding: '12px', textAlign: 'left', color: 'rgba(255, 255, 255, 0.5)', cursor: 'pointer', userSelect: 'none' }}
                    >
                      Address{getSortIndicator('address')}
                    </th>
                    <th
                      onClick={() => handleSort('pending')}
                      style={{ padding: '12px', textAlign: 'right', color: 'rgba(255, 255, 255, 0.5)', cursor: 'pointer', userSelect: 'none' }}
                    >
                      Pending{getSortIndicator('pending')}
                    </th>
                    <th
                      onClick={() => handleSort('paid')}
                      style={{ padding: '12px', textAlign: 'right', color: 'rgba(255, 255, 255, 0.5)', cursor: 'pointer', userSelect: 'none' }}
                    >
                      Paid{getSortIndicator('paid')}
                    </th>
                    <th
                      onClick={() => handleSort('hashes')}
                      style={{ padding: '12px', textAlign: 'right', color: 'rgba(255, 255, 255, 0.5)', cursor: 'pointer', userSelect: 'none' }}
                    >
                      Hashes{getSortIndicator('hashes')}
                    </th>
                    <th
                      onClick={() => handleSort('hashrate')}
                      style={{ padding: '12px', textAlign: 'right', color: 'rgba(255, 255, 255, 0.5)', cursor: 'pointer', userSelect: 'none' }}
                    >
                      Hashrate{getSortIndicator('hashrate')}
                    </th>
                    <th
                      onClick={() => handleSort('lastShare')}
                      style={{ padding: '12px', textAlign: 'left', color: 'rgba(255, 255, 255, 0.5)', cursor: 'pointer', userSelect: 'none' }}
                    >
                      Last Share{getSortIndicator('lastShare')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {getSortedUsers().map(([address, user], index) => (
                    <tr key={address} style={{ borderBottom: index === getSortedUsers().length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.03)' }}>
                      <td style={{ padding: '12px', color: '#ffffff', fontFamily: 'monospace' }}>
                        {address}
                      </td>
                      <td style={{ padding: '12px', color: '#ffffff', textAlign: 'right' }}>{formatAmount(parseFloat(user.pending || '0'))}</td>
                      <td style={{ padding: '12px', color: 'rgb(16, 185, 129)', textAlign: 'right' }}>{formatAmount(parseFloat(user.paid || '0'))}</td>
                      <td style={{ padding: '12px', color: '#ffffff', textAlign: 'right' }}>{formatLargeNumber(parseFloat(user.hashes || '0'))}</td>
                      <td style={{ padding: '12px', color: '#ffffff', textAlign: 'right' }}>{formatHashRate(user.hashrate || 0)}</td>
                      <td style={{ padding: '12px', color: 'rgba(255, 255, 255, 0.5)' }}>
                        {user.lastShare ? new Date(parseInt(user.lastShare) * 1000).toLocaleString() : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'monitoring' && (
          <div style={{ padding: '24px' }}>
            <h2 style={{ color: '#ffffff', marginBottom: '20px', fontSize: '1.25rem' }}>Monitoring</h2>
            {adminMonitoring && (
              <>
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ color: '#ffffff', marginBottom: '16px', fontSize: '1rem' }}>Service Status</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                    <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                      <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', marginBottom: '8px' }}>Daemon</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ color: adminMonitoring.monitoring.daemon.lastStatus === 'ok' ? 'rgb(16, 185, 129)' : '#ef4444', fontSize: '1rem', fontWeight: 600 }}>
                          {adminMonitoring.monitoring.daemon.lastStatus === 'ok' ? 'Online' : 'Offline'}
                        </div>
                        <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '0.75rem' }}>
                          {adminMonitoring.monitoring.daemon.lastResponse}
                        </div>
                      </div>
                      <div style={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: '0.7rem', marginTop: '8px' }}>
                        Last check: {new Date(parseInt(adminMonitoring.monitoring.daemon.lastCheck) * 1000).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                      <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', marginBottom: '8px' }}>Wallet</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ color: adminMonitoring.monitoring.wallet.lastStatus === 'ok' ? 'rgb(16, 185, 129)' : '#ef4444', fontSize: '1rem', fontWeight: 600 }}>
                          {adminMonitoring.monitoring.wallet.lastStatus === 'ok' ? 'Online' : 'Offline'}
                        </div>
                        <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '0.75rem' }}>
                          {adminMonitoring.monitoring.wallet.lastResponse}
                        </div>
                      </div>
                      <div style={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: '0.7rem', marginTop: '8px' }}>
                        Last check: {new Date(parseInt(adminMonitoring.monitoring.wallet.lastCheck) * 1000).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ marginBottom: '24px' }}>
                  {(() => {
                    if (!adminMonitoring?.logs) return null;

                    // Group logs by level
                    const logGroups: Record<string, Array<[string, { size: number, changed: number }]>> = {
                      error: [],
                      warn: [],
                      crash: [],
                      info: [],
                      other: []
                    };

                    Object.entries(adminMonitoring.logs).forEach(([filename, info]) => {
                      const lower = filename.toLowerCase();
                      if (lower.includes('_error.')) {
                        logGroups.error.push([filename, info]);
                      } else if (lower.includes('_warn.')) {
                        logGroups.warn.push([filename, info]);
                      } else if (lower.includes('_crash.')) {
                        logGroups.crash.push([filename, info]);
                      } else if (lower.includes('_info.')) {
                        logGroups.info.push([filename, info]);
                      } else {
                        logGroups.other.push([filename, info]);
                      }
                    });

                    // Calculate totals per category and grand total
                    const groupTotals: Record<string, number> = {};
                    let grandTotal = 0;
                    Object.keys(logGroups).forEach(key => {
                      const total = logGroups[key].reduce((sum, [, info]) => sum + info.size, 0);
                      groupTotals[key] = total;
                      grandTotal += total;
                    });

                    const formatBytes = (bytes: number): string => {
                      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
                      if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
                      return `${bytes} B`;
                    };

                    const groupColors: Record<string, { border: string, bg: string, text: string }> = {
                      error: { border: 'rgba(239, 68, 68, 0.3)', bg: 'rgba(239, 68, 68, 0.1)', text: 'rgb(239, 68, 68)' },
                      warn: { border: 'rgba(245, 158, 11, 0.3)', bg: 'rgba(245, 158, 11, 0.1)', text: 'rgb(245, 158, 11)' },
                      crash: { border: 'rgba(168, 85, 247, 0.3)', bg: 'rgba(168, 85, 247, 0.1)', text: 'rgb(168, 85, 247)' },
                      info: { border: 'rgba(16, 185, 129, 0.3)', bg: 'rgba(16, 185, 129, 0.1)', text: 'rgb(16, 185, 129)' },
                      other: { border: 'rgba(255, 255, 255, 0.1)', bg: 'rgba(255, 255, 255, 0.02)', text: 'rgba(255, 255, 255, 0.6)' }
                    };

                    const groupOrder: Array<{ key: string; label: string }> = [
                      { key: 'error', label: 'Error' },
                      { key: 'warn', label: 'Warning' },
                      { key: 'crash', label: 'Crash' },
                      { key: 'info', label: 'Info' },
                      { key: 'other', label: 'Other' }
                    ];

                    return (
                      <>
                        <h3 style={{ color: '#ffffff', marginBottom: '16px', fontSize: '1rem' }}>
                          Log Files ({Object.keys(adminMonitoring.logs).length}) • Total: {formatBytes(grandTotal)}
                        </h3>
                        {groupOrder.filter(g => logGroups[g.key].length > 0).map(group => (
                      <div key={group.key} style={{ marginBottom: '20px' }}>
                        <h4 style={{ color: groupColors[group.key].text, fontSize: '0.9rem', fontWeight: 600, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {group.label} ({logGroups[group.key].length}) • {formatBytes(groupTotals[group.key])}
                        </h4>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                          {logGroups[group.key].map(([filename, info]) => {
                            const colors = groupColors[group.key];
                            return (
                              <div
                                key={filename}
                                onClick={() => fetchLogFile(filename, true)}
                                style={{
                                  padding: '10px 12px',
                                  background: colors.bg,
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s',
                                  border: selectedLogFile === filename ? '1px solid rgb(255, 192, 251)' : colors.border
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = colors.bg.replace('0.1', '0.15').replace('0.02', '0.05'); }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = colors.bg; }}
                              >
                                <div style={{ color: colors.text, fontSize: '0.8rem', fontWeight: 500, marginBottom: '4px' }}>{filename}</div>
                                <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '0.7rem' }}>
                                  {(info.size / 1024).toFixed(1)} KB • {new Date(info.changed * 1000).toLocaleDateString()}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </>
                );
                  })()}
                </div>
              </>
            )}
            {adminPorts?.ports && Object.keys(adminPorts.ports).length > 0 && (
              <div>
                <h3 style={{ color: '#ffffff', marginBottom: '16px', fontSize: '1rem' }}>Port Usage</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' }}>
                  {Object.entries(adminPorts.ports).map(([port, users]) => (
                    <div key={port} style={{ padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                      <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', marginBottom: '4px' }}>Port {port}</div>
                      <div style={{ color: '#ffffff', fontSize: '1.25rem', fontWeight: 600 }}>{users || 0}</div>
                      <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '0.75rem' }}>users</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div style={{ padding: '24px' }}>
            <h2 style={{ color: '#ffffff', marginBottom: '20px', fontSize: '1.25rem' }}>Log Viewer{selectedLogFile && ` - ${selectedLogFile}`}</h2>
            {adminMonitoring?.logs && Object.keys(adminMonitoring.logs).length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <select
                  value={selectedLogFile}
                  onChange={(e) => fetchLogFile(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '0.9rem',
                    cursor: 'pointer'
                  }}
                >
                  <option value="">Select a log file...</option>
                  {Object.keys(adminMonitoring.logs || {}).map((file) => (
                    <option key={file} value={file} style={{ background: '#282729' }}>{file}</option>
                  ))}
                </select>
              </div>
            )}
            <div
              ref={setLogScrollRef}
              onScroll={handleLogScroll}
              style={{
                padding: '16px',
                background: '#1a1a1a',
                borderRadius: '8px',
                maxHeight: '500px',
                overflow: 'auto',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                color: '#ffffff',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                position: 'relative'
              }}
            >
              {loading && displayedLogLines.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255, 255, 255, 0.5)' }}>Loading...</div>
              ) : displayedLogLines.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255, 255, 255, 0.5)' }}>Select a log file to view</div>
              ) : (
                <>
                  {hasMoreLogs && (
                    <div style={{
                      padding: '8px',
                      marginBottom: '8px',
                      background: 'rgba(255, 192, 251, 0.1)',
                      borderRadius: '4px',
                      textAlign: 'center',
                      color: 'rgb(255, 192, 251)',
                      fontSize: '0.75rem'
                    }}>
                      {loading ? 'Loading more logs...' : '↑ Scroll to top to load more logs'}
                    </div>
                  )}
                  {displayedLogLines.map((line, index) => (
                    <div key={index} style={{ marginBottom: '2px', lineHeight: '1.4' }}>{line}</div>
                  ))}
                  <div style={{
                    marginTop: '16px',
                    paddingTop: '8px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                    color: 'rgba(255, 255, 255, 0.3)',
                    fontSize: '0.7rem',
                    textAlign: 'center'
                  }}>
                    Showing {displayedLogLines.length} of {allLogLines.length} lines
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Admin;
