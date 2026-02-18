import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTachometerAlt,
  faRocket,
  faCubes,
  faCoins,
  faChartBar,
  faSearch,
  faBars,
  faTimes,
  faChevronDown,
  faChevronUp,
  faSpinner
} from '@fortawesome/free-solid-svg-icons';
import { useToast } from './useToast';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import apiService from '../../services/api';
import logo from '../../assets/logo.png';
import type { MinerStats, WorkerStats, Payment, Block } from '../../types';

interface NavItem {
  path: string;
  label: string;
  icon: IconDefinition;
}

interface SavedAddress {
  address: string;
  timestamp: number;
}

const Navigation: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [showAddressDropdown, setShowAddressDropdown] = React.useState(false);
  const [selectedAddress, setSelectedAddress] = React.useState<string | null>(null);
  const [isSearching, setIsSearching] = React.useState(true);
  const [isValidatingAddress, setIsValidatingAddress] = React.useState(false);
  const [minerHashrate, setMinerHashrate] = React.useState<number | null>(null);
  const navigate = useNavigate();
  const { showToast } = useToast();

  // Load saved addresses from localStorage on mount
  React.useEffect(() => {
    const saved = localStorage.getItem('savedWalletAddresses');
    if (saved) {
      try {
        const addresses = JSON.parse(saved);
        // Auto-select the most recent address
        if (addresses.length > 0) {
          setSelectedAddress(addresses[0].address);
          setIsSearching(false);
        }
      } catch (e) {
        console.error('Failed to parse saved addresses:', e);
      }
    }
  }, []);

  // Fetch miner stats when address changes
  React.useEffect(() => {
    if (!selectedAddress) {
      setMinerHashrate(null);
      return;
    }

    const fetchMinerStats = async () => {
      try {
        const data = await apiService.getMinerStats(selectedAddress) as {
          stats?: MinerStats;
          workers?: WorkerStats[];
          payments?: Payment[];
          blocks?: Block[];
          charts?: Record<string, unknown>;
        } | MinerStats;

        // Handle both nested and direct response formats
        const stats = 'stats' in data ? data.stats : data;
        const hashRate = stats && ('hashRate' in stats ? (stats as MinerStats).hashRate : (stats as Record<string, unknown>).hashrate as number | undefined);

        if (hashRate !== undefined) {
          setMinerHashrate(hashRate);
        }
      } catch (error) {
        console.error('Failed to fetch miner stats:', error);
      }
    };

    fetchMinerStats();
    // Refresh every 5 seconds to sync with Dashboard stats
    const interval = setInterval(fetchMinerStats, 5000);
    return () => clearInterval(interval);
  }, [selectedAddress]);

  // Save addresses to localStorage whenever they change
  const saveToLocalStorage = (addresses: SavedAddress[]) => {
    localStorage.setItem('savedWalletAddresses', JSON.stringify(addresses));
  };

  const navItems: NavItem[] = [
    { path: '/', label: 'Dashboard', icon: faTachometerAlt },
    { path: '/start', label: 'Start', icon: faRocket },
    { path: '/blocks', label: 'Blocks', icon: faCubes },
    { path: '/payments', label: 'Payments', icon: faCoins },
    { path: '/top', label: 'Top Miners', icon: faChartBar },
  ];

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!searchTerm.trim()) {
      return;
    }

    // Validate it looks like an address (basic check)
    if (searchTerm.length > 20) {
      try {
        setIsValidatingAddress(true);

        // Validate address by checking if it exists in the API
        const response = await apiService.getMinerStats(searchTerm) as MinerStats & { payments?: Payment[], charts?: Record<string, unknown>, workers?: WorkerStats[] } | { error: string };

        // Check if API returned an error
        if ('error' in response && response.error === 'Not found') {
          showToast('Invalid wallet address. Please check and try again.', 'error');
          setIsValidatingAddress(false);
          return;
        }

        // Save to local storage (replace all with just this one)
        const newAddress: SavedAddress = {
          address: searchTerm,
          timestamp: Date.now()
        };
        saveToLocalStorage([newAddress]);

        setSelectedAddress(searchTerm);
        setSearchTerm('');
        setIsSearching(false);
        setMobileMenuOpen(false);

        navigate(`/miner/${searchTerm}`);
      } catch (error) {
        console.error('Error validating address:', error);
        showToast('Error validating wallet address. Please try again.', 'error');
      } finally {
        setIsValidatingAddress(false);
      }
    } else {
      showToast('Wallet address must be longer than 20 characters.', 'error');
    }
  };

  const handleRemoveAddress = () => {
    setSelectedAddress(null);
    setIsSearching(true);
    saveToLocalStorage([]);
    navigate('/');
  };

  const truncateAddress = (address: string) => {
    if (address.length <= 15) return address;
    return `${address.substring(0, 8)}...${address.substring(address.length - 5)}`;
  };

  const formatHashrate = (hashrate: number | null) => {
    if (hashrate === null) return '';
    if (!hashrate || hashrate === 0) return '0 H/s';
    if (hashrate >= 1000000000000000) return `${(hashrate / 1000000000000000).toFixed(2)} PH/s`;
    if (hashrate >= 1000000000000) return `${(hashrate / 1000000000000).toFixed(2)} TH/s`;
    if (hashrate >= 1000000000) return `${(hashrate / 1000000000).toFixed(2)} GH/s`;
    if (hashrate >= 1000000) return `${(hashrate / 1000000).toFixed(2)} MH/s`;
    if (hashrate >= 1000) return `${(hashrate / 1000).toFixed(2)} KH/s`;
    return `${hashrate.toFixed(2)} H/s`;
  };

  const isActive = (path: string) => {
    return window.location.pathname === path;
  };

  // Close dropdowns when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.search-container') && !target.closest('.address-dropdown')) {
        setIsSearching(false);
        setShowAddressDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <>
      {/* Desktop Navigation */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        background: '#282729',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', paddingLeft: '24px', width: '100%' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            height: '64px',
            width: '100%'
          }}>
            {/* Logo */}
            <Link
              to="/"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                textDecoration: 'none',
                fontSize: '1.25rem',
                fontWeight: 700,
                color: '#ffffff',
                letterSpacing: '0.5px',
                flexShrink: 0,
                marginRight: '24px'
              }}
            >
              <img
                src={logo}
                alt="Pastella Pool"
                style={{
                  width: '27px',
                  height: '27px',
                  borderRadius: '6px',
                  objectFit: 'contain'
                }}
              />
              <span className="logo-text">
                <span style={{ color: 'rgb(255 192 251)' }}>Pas</span>tella
              </span>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 400 }}>
                Pool
              </span>
            </Link>

            {/* Desktop Menu */}
            <div className="desktop-menu" style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px'
            }}>
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    textDecoration: 'none',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: isActive(item.path) ? 'rgb(255 192 251)' : 'rgba(255, 255, 255, 0.7)',
                    background: isActive(item.path) ? 'rgba(255, 192, 251, 0.1)' : 'transparent',
                    transition: 'all 0.2s ease',
                    whiteSpace: 'nowrap'
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive(item.path)) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive(item.path)) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                    }
                  }}
                >
                  <FontAwesomeIcon icon={item.icon} style={{ fontSize: '0.875rem' }} />
                  {item.label}
                </Link>
              ))}
            </div>

            {/* Search */}
            <div className="search-container desktop-search" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0, marginLeft: 'auto', paddingRight: '24px', position: 'relative' }}>
              {isSearching || !selectedAddress ? (
                <>
                  {/* Search Bar with button inside */}
                  <form onSubmit={handleSearch} style={{ position: 'relative', width: '300px', minWidth: 0 }}>
                    <FontAwesomeIcon
                      icon={faSearch}
                      style={{
                        position: 'absolute',
                        left: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'rgba(255, 255, 255, 0.5)',
                        fontSize: '0.875rem',
                        pointerEvents: 'none',
                        zIndex: 1
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Search wallet address..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 50px 8px 36px',
                        background: 'rgba(0, 0, 0, 0.2)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        color: '#ffffff',
                        fontSize: '0.875rem',
                        outline: 'none',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        if (document.activeElement !== e.currentTarget) {
                          e.currentTarget.style.borderColor = 'rgba(255, 192, 251, 0.3)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (document.activeElement !== e.currentTarget) {
                          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        }
                      }}
                      className="search-input"
                    />
                    <button
                      type="submit"
                      disabled={isValidatingAddress}
                      style={{
                        position: 'absolute',
                        right: '6px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        padding: '8px',
                        width: '36px',
                        height: '36px',
                        background: 'rgba(255, 192, 251, 0.2)',
                        border: '1px solid rgba(255, 192, 251, 0.4)',
                        borderRadius: '6px',
                        color: 'rgb(255, 192, 251)',
                        cursor: isValidatingAddress ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s',
                        outline: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: isValidatingAddress ? 0.6 : 1
                      }}
                      onMouseEnter={(e) => {
                        if (!isValidatingAddress) {
                          e.currentTarget.style.background = 'rgba(255, 192, 251, 0.3)';
                          e.currentTarget.style.borderColor = 'rgba(255, 192, 251, 0.6)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 192, 251, 0.2)';
                        e.currentTarget.style.borderColor = 'rgba(255, 192, 251, 0.4)';
                      }}
                    >
                      <FontAwesomeIcon
                        icon={isValidatingAddress ? faSpinner : faSearch}
                        spin={isValidatingAddress}
                        style={{ fontSize: '0.875rem' }}
                      />
                    </button>
                  </form>
                </>
              ) : (
                <>
                  {/* Selected Address Display with Arrow */}
                  <div style={{ position: 'relative' }}>
                    <div
                      onClick={() => setShowAddressDropdown(!showAddressDropdown)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 16px',
                        background: 'rgba(255, 192, 251, 0.1)',
                        border: '1px solid rgba(255, 192, 251, 0.3)',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(255, 192, 251, 0.5)'}
                      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255, 192, 251, 0.3)'}
                    >
                      <span style={{
                        color: 'rgba(255, 255, 255, 0.9)',
                        fontFamily: 'monospace',
                        fontSize: '0.875rem'
                      }}>
                        {selectedAddress ? truncateAddress(selectedAddress) : ''}
                      </span>
                      {minerHashrate !== null && (
                        <span style={{
                          color: 'rgba(255, 192, 251, 0.8)',
                          fontSize: '0.75rem',
                          fontWeight: 500
                        }}>
                          {formatHashrate(minerHashrate)}
                        </span>
                      )}

                      <FontAwesomeIcon
                        icon={showAddressDropdown ? faChevronUp : faChevronDown}
                        style={{ fontSize: '0.75rem', color: 'rgb(255, 192, 251)' }}
                      />
                    </div>

                    {/* Dropdown Menu */}
                    {showAddressDropdown && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '8px',
                        width: '200px',
                        background: '#1e1e1e',
                        border: '1px solid rgba(255, 192, 251, 0.3)',
                        borderRadius: '8px',
                        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
                        zIndex: 2000,
                        overflow: 'hidden'
                      }}>
                        <div
                          onClick={() => {
                            if (selectedAddress) {
                              setShowAddressDropdown(false);
                              navigate(`/miner/${selectedAddress}`);
                            }
                          }}
                          style={{
                            padding: '12px 16px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            transition: 'background 0.2s',
                            fontSize: '0.875rem'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 192, 251, 0.15)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          <FontAwesomeIcon icon={faChartBar} style={{ fontSize: '0.875rem', color: 'rgb(255, 192, 251)' }} />
                          <span style={{ color: 'rgba(255, 255, 255, 0.9)' }}>Stats</span>
                        </div>
                        <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.1)' }}></div>
                        <div
                          onClick={() => handleRemoveAddress()}
                          style={{
                            padding: '12px 16px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            transition: 'background 0.2s',
                            fontSize: '0.875rem'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          <FontAwesomeIcon icon={faTimes} style={{ fontSize: '0.875rem', color: 'rgb(239, 68, 68)' }} />
                          <span style={{ color: 'rgba(239, 68, 68, 0.9)' }}>Change Address</span>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Mobile Menu Toggle */}
            <button
              className="mobile-menu-toggle"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={{
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                width: '40px',
                height: '40px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                color: 'rgba(255, 255, 255, 0.7)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                marginLeft: 'auto',
                marginRight: '24px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              }}
            >
              <FontAwesomeIcon icon={mobileMenuOpen ? faTimes : faBars} style={{ fontSize: '1rem' }} />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <>
          <div
            onClick={() => setMobileMenuOpen(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(4px)',
              zIndex: 999
            }}
          />
          <div style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: '300px',
            maxWidth: '85vw',
            background: '#282729',
            zIndex: 1000,
            boxShadow: '-4px 0 30px rgba(0, 0, 0, 0.5)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)'
          }}>
            <div style={{
              padding: '24px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '1.125rem',
                fontWeight: 700,
                color: '#ffffff'
              }}>
                Pastella
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                style={{
                  width: '32px',
                  height: '32px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'rgba(255, 255, 255, 0.7)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <FontAwesomeIcon icon={faTimes} style={{ fontSize: '0.875rem' }} />
              </button>
            </div>

            {/* Wallet Address Display in Mobile Menu */}
            {selectedAddress && (
              <div style={{
                padding: '16px 24px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 192, 251, 0.05)'
              }}>
                <div style={{ marginBottom: '8px', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>
                  WALLET ADDRESS
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      color: 'rgba(255, 255, 255, 0.9)',
                      fontFamily: 'monospace',
                      fontSize: '0.875rem',
                      wordBreak: 'break-all'
                    }}>
                      {truncateAddress(selectedAddress)}
                    </div>
                    {minerHashrate !== null && (
                      <div style={{
                        color: 'rgba(255, 192, 251, 0.8)',
                        fontSize: '0.8125rem',
                        fontWeight: 500,
                        marginTop: '4px'
                      }}>
                        {formatHashrate(minerHashrate)}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{
                  marginTop: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <button
                    onClick={() => {
                      if (selectedAddress) {
                        navigate(`/miner/${selectedAddress}`);
                      }
                      setMobileMenuOpen(false);
                    }}
                    style={{
                      padding: '10px 12px',
                      width: '100%',
                      background: 'rgba(255, 192, 251, 0.1)',
                      border: '1px solid rgba(255, 192, 251, 0.3)',
                      borderRadius: '6px',
                      color: 'rgb(255 192 251)',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'all 0.2s'
                    }}
                  >
                    <FontAwesomeIcon icon={faChartBar} style={{ fontSize: '0.875rem' }} />
                    <span>View Stats</span>
                  </button>
                  <button
                    onClick={() => {
                      handleRemoveAddress();
                    }}
                    style={{
                      padding: '10px 12px',
                      width: '100%',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: 'rgb(239, 68, 68)',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'all 0.2s'
                    }}
                  >
                    <FontAwesomeIcon icon={faTimes} style={{ fontSize: '0.875rem' }} />
                    <span>Change Address</span>
                  </button>
                </div>
              </div>
            )}

            <div style={{ padding: '16px 24px' }}>
              <form onSubmit={handleSearch} style={{ position: 'relative' }}>
                <FontAwesomeIcon
                  icon={faSearch}
                  style={{
                    position: 'absolute',
                    left: '16px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'rgba(255, 255, 255, 0.5)',
                    fontSize: '0.875rem',
                    zIndex: 1
                  }}
                />
                <input
                  type="text"
                  placeholder="Search address..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                  style={{
                    width: '100%',
                    padding: '12px 12px 12px 44px',
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '0.875rem',
                    outline: 'none',
                    transition: 'all 0.2s'
                  }}
                />
              </form>
            </div>

            <div style={{ flex: 1, padding: '8px 0' }}>
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 24px',
                    textDecoration: 'none',
                    fontSize: '0.9375rem',
                    fontWeight: 500,
                    color: isActive(item.path) ? 'rgb(255 192 251)' : 'rgba(255, 255, 255, 0.8)',
                    background: isActive(item.path) ? 'rgba(255, 192, 251, 0.1)' : 'transparent',
                    borderLeft: isActive(item.path) ? '3px solid rgb(200, 130, 200)' : '3px solid transparent',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive(item.path)) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive(item.path)) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <FontAwesomeIcon icon={item.icon} style={{ fontSize: '1rem', width: '20px', textAlign: 'center' }} />
                  {item.label}
                </Link>
              ))}
            </div>

            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              fontSize: '0.75rem',
              color: 'rgba(255, 255, 255, 0.5)',
              textAlign: 'center'
            }}>
              © 2026 Pastella Mining Pool
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        /* Pink focus border for search inputs */
        .search-input:focus {
          border-color: rgba(255, 192, 251, 0.5) !important;
          box-shadow: 0 0 0 3px rgba(255, 192, 251, 0.1);
        }
      `}</style>
    </>
  );
};

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }: LayoutProps) => {
  return (
    <>
      <Navigation />
      <main role="main" style={{
        marginTop: '80px',
        marginBottom: '20px',
        marginLeft: 'auto',
        marginRight: 'auto',
        maxWidth: '1200px',
        padding: '0 15px',
        width: '100%'
      }}>
        {children}
      </main>
    </>
  );
};

export default Layout;
export { Navigation };
