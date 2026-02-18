import React, { useState, useEffect } from 'react';
import apiService from '../../services/api';
import config from '../../config/pool';
import type { ApiConfig } from '../../types';

const Start: React.FC = () => {
  const [poolConfig, setPoolConfig] = useState<ApiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPort, setSelectedPort] = useState<string>('');
  const [username, setUsername] = useState<string>('YOUR_WALLET_ADDRESS');
  const [password, setPassword] = useState<string>('WORKER_NAME');
  const [soloMining, setSoloMining] = useState<boolean>(false);
  const [fixedDiffEnabled, setFixedDiffEnabled] = useState<boolean>(false);
  const [fixedDiffValue, setFixedDiffValue] = useState<string>('');
  const [selectedArch, setSelectedArch] = useState<string>('All');
  const [isWindows, setIsWindows] = useState<boolean>(false);

  useEffect(() => {
    const fetchPoolConfig = async () => {
      try {
        setLoading(true);
        const poolStats = await apiService.getPoolStats();
        if (poolStats.config) {
          setPoolConfig(poolStats.config as unknown as ApiConfig);
          // Set default port (first port)
          const config = poolStats.config as unknown as ApiConfig;
          const ports = config.ports;
          if (ports && Array.isArray(ports) && ports.length > 0) {
            setSelectedPort(ports[0].port.toString());
          }
        }
        setLoading(false);
      } catch (error) {
        console.error('Error fetching pool config:', error);
        setLoading(false);
      }
    };

    fetchPoolConfig();
  }, []);

  const getAlgorithmName = (algorithm: string | undefined): string => {
    if (!algorithm) return 'Unknown';
    if (algorithm.toLowerCase() === 'randomx') return 'RandomX';
    return algorithm;
  };

  const generateCommand = (template: string, hostname: string, port: string, software?: typeof config.miningSoftware[0]): string => {
    let finalUsername = soloMining ? `solo:${username}` : username;
    if (fixedDiffEnabled && fixedDiffValue) {
      const separator = poolConfig?.fixedDiffSeparator || '.';
      finalUsername = `${finalUsername}${separator}${fixedDiffValue}`;
    }

    let command = template
      .replace('{hostname}', hostname)
      .replace('{port}', port)
      .replace('{username}', finalUsername)
      .replace('{password}', password)
      .replace('{windows}', isWindows ? '.exe' : '');

    // Replace algorithm if template has {algorithm} placeholder
    if (software && command.includes('{algorithm}')) {
      const poolAlgorithm = poolConfig?.cnAlgorithm?.toLowerCase().replace(/\s+/g, '');
      let algoValue: string | undefined = undefined;

      if (poolAlgorithm && software.algorithms) {
        // Try exact match first
        algoValue = (software.algorithms as Record<string, string>)[poolAlgorithm];

        // If not found, try with spaces removed and common variations
        if (!algoValue) {
          const variations = [
            poolAlgorithm,
            poolAlgorithm.replace(/[^a-z0-9]/gi, ''),
            poolAlgorithm.replace(/_/g, ''),
          ];

          for (const variant of variations) {
            const value = (software.algorithms as Record<string, string>)[variant];
            if (value) {
              algoValue = value;
              break;
            }
          }
        }
      }

      if (algoValue) {
        command = command.replace('{algorithm}', algoValue);
      } else {
        // Fallback: if no mapping found, use the software's first algorithm or pool algorithm
        const firstAlgo = software?.algorithms ? Object.values(software.algorithms as Record<string, string>)[0] : null;
        command = command.replace('{algorithm}', firstAlgo || poolConfig?.cnAlgorithm || 'rx');
      }
    }

    return command;
  };

  const copyCommand = (command: string) => {
    navigator.clipboard.writeText(command);
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

  const miningSoftware = config.miningSoftware || [];

  // Get all unique architectures
  const allArchitectures = Array.from(
    new Set(miningSoftware.flatMap(sw => sw.architectures))
  ).sort();

  // Filter software based on selected architecture
  const filteredSoftware = selectedArch === 'All'
    ? miningSoftware
    : miningSoftware.filter(sw =>
        sw.architectures.some(arch => arch.toLowerCase() === selectedArch.toLowerCase())
      );

  return (
    <div>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, color: '#ffffff', marginBottom: '30px' }}>
        Getting Started
      </h1>

      {/* Pool Configuration */}
      <div className="card card-dark" style={{
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '12px',
        background: '#282729',
        marginBottom: '30px',
        overflow: 'hidden'
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
        <div className="card-body" style={{ padding: '16px', overflow: 'hidden' }}>
          {poolConfig ? (
            <div className="row" style={{ margin: 0 }}>
              <div className="col-12 col-md-6 col-lg-4 mb-3" style={{ padding: '0 10px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                  Pool Host
                </div>
                <div className="mobile-md-text" style={{ fontSize: '0.95rem', color: '#e2e8f0', fontWeight: 600, fontFamily: 'monospace', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                  {poolConfig?.poolHost || config.api?.split('://')[1]?.split(':')[0] || 'N/A'}
                </div>
              </div>

              <div className="col-12 col-md-6 col-lg-4 mb-3" style={{ padding: '0 10px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                  Algorithm
                </div>
                <div className="mobile-md-text" style={{ fontSize: '0.95rem', color: 'rgb(255 192 251)', fontWeight: 600 }}>
                  {getAlgorithmName(poolConfig.cnAlgorithm)}
                </div>
              </div>

              <div className="col-12 col-md-6 col-lg-4 mb-3" style={{ padding: '0 10px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                  Pool Fee
                </div>
                <div className="mobile-md-text" style={{ fontSize: '0.95rem', color: '#e2e8f0', fontWeight: 600 }}>
                  {poolConfig.fee}%
                </div>
              </div>

              <div className="col-12 col-md-6 col-lg-4 mb-3" style={{ padding: '0 10px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                  Minimum Payout
                </div>
                <div className="mobile-md-text" style={{ fontSize: '0.95rem', color: '#e2e8f0', fontWeight: 600 }}>
                  {poolConfig.minPaymentThreshold && poolConfig.coinUnits
                    ? `${(poolConfig.minPaymentThreshold / poolConfig.coinUnits).toFixed(2)} ${poolConfig.symbol || ''}`
                    : `${poolConfig.symbol || 'N/A'}`
                  }
                </div>
              </div>

              <div className="col-12 col-md-6 col-lg-4 mb-3" style={{ padding: '0 10px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                  Payout Interval
                </div>
                <div className="mobile-md-text" style={{ fontSize: '0.95rem', color: '#e2e8f0', fontWeight: 600 }}>
                  {poolConfig.paymentsInterval ? `${poolConfig.paymentsInterval / 60} minutes` : 'N/A'}
                </div>
              </div>

              <div className="col-12 col-md-6 col-lg-4 mb-3" style={{ padding: '0 10px' }}>
                <div className="mobile-sm-text" style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                  Block Time
                </div>
                <div className="mobile-md-text" style={{ fontSize: '0.95rem', color: '#e2e8f0', fontWeight: 600 }}>
                  {poolConfig.coinDifficultyTarget ? `${poolConfig.coinDifficultyTarget} seconds` : 'N/A'}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Loading pool configuration...</div>
          )}
        </div>
      </div>

      {/* Mining Instructions */}
      <div className="card card-dark" style={{
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '12px',
        background: '#282729',
        marginBottom: '30px',
        overflow: 'hidden'
      }}>
        <div className="card-header p-3" style={{
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          background: 'linear-gradient(135deg, #282729 0%, #222123 100%)',
          borderRadius: '12px 12px 0 0'
        }}>
          <h6 className="mb-0 text-white" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
            Mining Configuration
          </h6>
        </div>
        <div className="card-body" style={{ padding: '15px 10px' }}>
          <div className="row" style={{ marginLeft: 0, marginRight: 0, marginBottom: '20px' }}>
            {/* Username Input */}
            <div className="col-12 col-md-6 mb-3" style={{ paddingLeft: '7.5px', paddingRight: '7.5px' }}>
              <label className="mobile-sm-text" style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '6px', fontWeight: 600 }}>
                USERNAME (Wallet Address)
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="YOUR_WALLET_ADDRESS"
                className="mobile-input"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  color: '#ffffff',
                  fontSize: '0.875rem',
                  fontFamily: 'monospace',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.5)'}
                onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
              />
            </div>

            {/* Password Input */}
            <div className="col-12 col-md-6 mb-3" style={{ paddingLeft: '7.5px', paddingRight: '7.5px' }}>
              <label className="mobile-sm-text" style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '6px', fontWeight: 600 }}>
                PASSWORD (Worker Name)
              </label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="WORKER_NAME"
                className="mobile-input"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  color: '#ffffff',
                  fontSize: '0.875rem',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.5)'}
                onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
              />
            </div>

            {/* Solo Mining Toggle */}
            <div className="col-12 col-md-6 mb-3" style={{ paddingLeft: '7.5px', paddingRight: '7.5px' }}>
              <label className="mobile-sm-text" style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '6px', fontWeight: 600 }}>
                MINING MODE
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setSoloMining(false)}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    background: !soloMining ? 'rgba(255, 192, 251, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    border: !soloMining ? '1px solid rgba(255, 192, 251, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    color: !soloMining ? 'rgb(255 192 251)' : 'rgba(255, 255, 255, 0.6)',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (!soloMining) e.currentTarget.style.background = 'rgba(255, 192, 251, 0.3)';
                    else e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                  }}
                  onMouseLeave={(e) => {
                    if (!soloMining) e.currentTarget.style.background = 'rgba(255, 192, 251, 0.2)';
                    else e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  }}
                >
                  POOL
                </button>
                <button
                  onClick={() => setSoloMining(true)}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    background: soloMining ? 'rgba(255, 192, 251, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    border: soloMining ? '1px solid rgba(255, 192, 251, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    color: soloMining ? 'rgb(255 192 251)' : 'rgba(255, 255, 255, 0.6)',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (!soloMining) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                  }}
                  onMouseLeave={(e) => {
                    if (!soloMining) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  }}
                >
                  SOLO
                </button>
              </div>
            </div>

            {/* Fixed Difficulty with Value Input */}
            <div className="col-12 col-md-6 mb-3" style={{ paddingLeft: '7.5px', paddingRight: '7.5px' }}>
              <label className="mobile-sm-text" style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '6px', fontWeight: 600 }}>
                FIXED DIFFICULTY
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setFixedDiffEnabled(false)}
                  style={{
                    padding: '10px 16px',
                    background: !fixedDiffEnabled ? 'rgba(255, 192, 251, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    border: !fixedDiffEnabled ? '1px solid rgba(255, 192, 251, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    color: !fixedDiffEnabled ? 'rgb(255 192 251)' : 'rgba(255, 255, 255, 0.6)',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (!fixedDiffEnabled) e.currentTarget.style.background = 'rgba(255, 192, 251, 0.3)';
                    else e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                  }}
                  onMouseLeave={(e) => {
                    if (!fixedDiffEnabled) e.currentTarget.style.background = 'rgba(255, 192, 251, 0.2)';
                    else e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  }}
                >
                  Off
                </button>
                <button
                  onClick={() => setFixedDiffEnabled(true)}
                  style={{
                    padding: '10px 16px',
                    background: fixedDiffEnabled ? 'rgba(255, 192, 251, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    border: fixedDiffEnabled ? '1px solid rgba(255, 192, 251, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    color: fixedDiffEnabled ? 'rgb(255 192 251)' : 'rgba(255, 255, 255, 0.6)',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (!fixedDiffEnabled) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                  }}
                  onMouseLeave={(e) => {
                    if (!fixedDiffEnabled) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  }}
                >
                  On
                </button>
                <input
                  type="text"
                  value={fixedDiffValue}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9]/g, '');
                    setFixedDiffValue(value);
                  }}
                  placeholder="e.g., 10000"
                  disabled={!fixedDiffEnabled}
                  className="mobile-input"
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: fixedDiffEnabled ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.15)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    color: fixedDiffEnabled ? '#ffffff' : 'rgba(255, 255, 255, 0.4)',
                    fontSize: '0.875rem',
                    fontFamily: 'monospace',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                    cursor: fixedDiffEnabled ? 'text' : 'not-allowed',
                    opacity: fixedDiffEnabled ? 1 : 0.6
                  }}
                  onFocus={(e) => {
                    if (fixedDiffEnabled) {
                      e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.5)';
                    }
                  }}
                  onBlur={(e) => {
                    if (fixedDiffEnabled) {
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    }
                  }}
                />
              </div>
            </div>

            {/* Operating System Selection */}
            <div className="col-12 col-md-6 mb-3" style={{ paddingLeft: '7.5px', paddingRight: '7.5px' }}>
              <label className="mobile-sm-text" style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '6px', fontWeight: 600 }}>
                OPERATING SYSTEM
              </label>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.875rem' }}>
                  <input
                    type="checkbox"
                    checked={isWindows}
                    onChange={(e) => setIsWindows(e.target.checked)}
                    style={{
                      width: '18px',
                      height: '18px',
                      cursor: 'pointer',
                      accentColor: 'rgb(255 192 251)'
                    }}
                  />
                  Windows (adds .exe)
                </label>
              </div>
            </div>
          </div>

          {/* Pool Ports */}
          {poolConfig && poolConfig.ports && (
            <div>
              <div className="mobile-sm-text" style={{ fontSize: '0.875rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '10px', fontWeight: 600 }}>
                SELECT MINING PORT
              </div>
              <div className="row gx-2 gy-1" style={{ marginLeft: 0, marginRight: 0 }}>
                {poolConfig.ports.map((portConfig) => (
                  <div
                    key={portConfig.port}
                    className="col-6 col-md-3"
                    style={{ paddingLeft: '0.375rem', paddingRight: '0.375rem' }}
                  >
                    <div
                      onClick={() => setSelectedPort(portConfig.port.toString())}
                      style={{
                        padding: '12px',
                        background: selectedPort === portConfig.port.toString() ? 'rgba(255, 192, 251, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '8px',
                        border: selectedPort === portConfig.port.toString() ? '1px solid rgba(255, 192, 251, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = selectedPort === portConfig.port.toString()
                        ? 'rgba(255, 192, 251, 0.15)'
                        : 'rgba(255, 255, 255, 0.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = selectedPort === portConfig.port.toString()
                        ? 'rgba(255, 192, 251, 0.1)'
                        : 'rgba(255, 255, 255, 0.03)';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.95rem', color: '#e2e8f0', fontWeight: 600 }}>
                        {portConfig.port}
                      </span>
                      <span style={{
                        fontSize: '0.7rem',
                        color: selectedPort === portConfig.port.toString() ? 'rgb(255 192 251)' : 'rgba(255, 255, 255, 0.4)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: selectedPort === portConfig.port.toString() ? 'rgba(255, 192, 251, 0.1)' : 'rgba(255, 255, 255, 0.05)'
                      }}>
                        {selectedPort === portConfig.port.toString() ? '✓' : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>
                      {portConfig.desc}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.4)', marginTop: '4px' }}>
                      Diff: {portConfig.difficulty.toLocaleString()}
                    </div>
                  </div>
                </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mining Software Downloads */}
      {miningSoftware.length > 0 && (
        <div className="card card-dark" style={{
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          background: '#282729',
          overflow: 'hidden'
        }}>
          <div className="card-header p-3" style={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            background: 'linear-gradient(135deg, #282729 0%, #222123 100%)',
            borderRadius: '12px 12px 0 0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px'
          }}>
            <h6 className="mb-0 text-white" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
              Mining Software
            </h6>
            {/* Filter Buttons */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', maxWidth: '100%' }}>
              <button
                onClick={() => setSelectedArch('All')}
                className="mobile-filter-btn"
                style={{
                  padding: '3px 8px',
                  background: selectedArch === 'All' ? 'rgba(255, 192, 251, 0.25)' : 'rgba(255, 192, 251, 0.1)',
                  borderRadius: '16px',
                  color: 'rgb(255 192 251)',
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  border: 'none',
                  minWidth: 'auto'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 192, 251, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = selectedArch === 'All' ? 'rgba(255, 192, 251, 0.25)' : 'rgba(255, 192, 251, 0.1)';
                }}
              >
                All
              </button>
              {allArchitectures.map((arch) => {
                const getArchColor = (architecture: string) => {
                  const archLower = architecture.toLowerCase();
                  switch (archLower) {
                    case 'nvidia': return '#7BBB08';
                    case 'amd': return '#DF0836';
                    case 'intel': return '#0875C7';
                    case 'cpu': return 'rgb(255 192 251)';
                    default: return 'rgba(255, 255, 255, 0.6)';
                  }
                };

                const archColor = getArchColor(arch);
                const isSelected = selectedArch.toLowerCase() === arch.toLowerCase();

                return (
                  <button
                    key={arch}
                    onClick={() => setSelectedArch(arch)}
                    className="mobile-filter-btn"
                    style={{
                      padding: '3px 8px',
                      background: isSelected ? `${archColor}40` : `${archColor}15`,
                      borderRadius: '16px',
                      color: archColor,
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      border: 'none',
                      minWidth: 'auto'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = isSelected ? `${archColor}50` : `${archColor}25`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isSelected ? `${archColor}40` : `${archColor}15`;
                    }}
                  >
                    {arch}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="card-body" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-responsive" style={{ overflowX: 'auto' }}>
              <table className="table mb-0" style={{ color: 'rgba(255, 255, 255, 0.7)', marginBottom: 0, width: '100%', tableLayout: 'auto' }}>
                <thead>
                  <tr style={{ background: 'rgba(0, 0, 0, 0.25)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, textAlign: 'left' }}>Software</th>
                    <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap' }}>Architecture</th>
                    <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, textAlign: 'left' }}>Download</th>
                    <th style={{ padding: '14px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.7rem', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap' }}>Command</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSoftware.map((software, index) => {
                  const selectedPortConfig = selectedPort && poolConfig?.ports.find(p => p.port.toString() === selectedPort);
                  const command = selectedPortConfig
                    ? generateCommand(software.commandTemplate, poolConfig?.poolHost || config.api?.split('://')[1]?.split(':')[0] || 'N/A', selectedPortConfig.port.toString(), software)
                    : '';

                  return (
                    <tr key={index} style={{ borderBottom: index === miningSoftware.length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.03)' }}>
                      <td style={{ padding: '14px', color: '#e2e8f0', fontSize: '0.875rem', fontWeight: 600 }}>
                        {software.name}
                      </td>
                      <td style={{ padding: '14px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'nowrap' }}>
                          {software.architectures.map((arch, i) => {
                            const getArchStyle = (architecture: string) => {
                              const archLower = architecture.toLowerCase();
                              switch (archLower) {
                                case 'nvidia':
                                  return {
                                    background: 'rgba(123, 187, 8, 0.15)',
                                    color: '#7BBB08'
                                  };
                                case 'amd':
                                  return {
                                    background: 'rgba(223, 8, 54, 0.15)',
                                    color: '#DF0836'
                                  };
                                case 'intel':
                                  return {
                                    background: 'rgba(8, 117, 199, 0.15)',
                                    color: '#0875C7'
                                  };
                                case 'cpu':
                                default:
                                  return {
                                    background: 'rgba(255, 192, 251, 0.1)',
                                    color: 'rgb(255 192 251)'
                                  };
                              }
                            };

                            const archStyle = getArchStyle(arch);

                            return (
                              <span
                                key={i}
                                style={{
                                  fontSize: '0.7rem',
                                  padding: '3px 8px',
                                  borderRadius: '4px',
                                  background: archStyle.background,
                                  color: archStyle.color,
                                  fontWeight: 600
                                }}
                              >
                                {arch}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td style={{ padding: '14px' }}>
                        <a
                          href={isWindows ? software.downloadLink.replace(/\/$/, '') + '.exe' : software.downloadLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-block',
                            padding: '6px 12px',
                            background: 'rgba(255, 192, 251, 0.1)',
                            borderRadius: '6px',
                            color: 'rgb(255 192 251)',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            textDecoration: 'none',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 192, 251, 0.2)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 192, 251, 0.1)';
                          }}
                        >
                          Download
                        </a>
                      </td>
                      <td style={{ padding: '14px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            flex: 1,
                            padding: '8px 12px',
                            background: 'rgba(0, 0, 0, 0.3)',
                            borderRadius: '6px',
                            fontFamily: 'monospace',
                            fontSize: '0.75rem',
                            color: 'rgb(255 192 251)',
                            wordBreak: 'break-all',
                            minWidth: 0
                          }}>
                            {command || 'Select a port to generate command'}
                          </div>
                          <button
                            onClick={() => command && copyCommand(command)}
                            disabled={!command}
                            style={{
                              padding: '6px 12px',
                              background: command ? 'rgba(255, 192, 251, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                              borderRadius: '6px',
                              color: command ? 'rgb(255 192 251)' : 'rgba(255, 255, 255, 0.3)',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: command ? 'pointer' : 'not-allowed',
                              transition: 'all 0.2s',
                              whiteSpace: 'nowrap',
                              border: 'none'
                            }}
                            onMouseEnter={(e) => {
                              if (command) {
                                e.currentTarget.style.background = 'rgba(255, 192, 251, 0.2)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (command) {
                                e.currentTarget.style.background = 'rgba(255, 192, 251, 0.1)';
                              }
                            }}
                          >
                            Copy
                          </button>
                        </div>
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
    </div>
  );
};

export default Start;
