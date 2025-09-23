// Mining Pool Dashboard JavaScript

class MiningPoolDashboard {
    constructor() {
        this.currentTab = 'overview';
        this.refreshInterval = null;
        this.currentMinersData = {}; // Store current miners data for timestamp updates
        this.charts = {}; // Store chart instances
        
        this.init();
    }

    init() {
        // Initialize the dashboard when DOM is loaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initialize());
        } else {
            this.initialize();
        }
    }

    initialize() {
        this.showTab('overview');
        this.loadTabData('overview');
        
        // Initial updates
        this.updateTotalHashrate();
        this.updateCurrentBlock();
        this.startAutoRefresh();
        
        // Load saved wallet address
        loadSavedWalletAddress();

        // Update timestamps more frequently (every 10 seconds)
        setInterval(() => {
            this.updateTimestamps();
        }, 10000);

        // Update hashrate data more frequently (every 5 seconds)
        setInterval(() => {
            this.updateTotalHashrate();
        }, 5000);

        // Setup cleanup on page unload
        window.addEventListener('beforeunload', () => {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
            }
        });
    }

    showTab(tabName, event) {
        // Hide all tab contents
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        // Remove active class from all tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
        });

        // Show selected tab content
        const tabContent = document.getElementById(tabName);
        if (tabContent) {
            tabContent.classList.add('active');
        }

        // Add active class to selected tab (if event is provided)
        if (event && event.target) {
            event.target.classList.add('active');
        } else {
            // Find the tab element and activate it
            const tabElement = document.querySelector(`[onclick*="${tabName}"]`);
            if (tabElement) {
                tabElement.classList.add('active');
            }
        }

        // Load tab data
        this.currentTab = tabName;
        this.loadTabData(tabName);
    }

    loadTabData(tabName) {
        switch(tabName) {
            case 'overview':
                this.fetchPoolData();
                break;
            case 'your-stats':
                // Load saved wallet address and auto-lookup if available
                loadSavedWalletAddress();
                break;
            case 'miners':
                this.fetchMinersData();
                break;
            case 'blocks':
                this.fetchBlocksData();
                break;
            case 'payments':
                this.fetchPaymentsData();
                break;
            case 'stats':
                this.fetchStatsData();
                break;
            case 'analytics':
                this.fetchStatsData();
                this.fetchAnalyticsData();
                break;
            case 'leaderboard':
                this.fetchLeaderboardData();
                break;
            case 'network':
                this.fetchNetworkData();
                break;
        }
    }

    startAutoRefresh() {
        this.refreshInterval = setInterval(() => {
            if (this.currentTab) {
                this.loadTabData(this.currentTab);
            }
            // Also update hashrate data, current block, and miner data every 30 seconds
            this.updateTotalHashrate();
            this.updateCurrentBlock();
            this.refreshMinerData();
            this.updateTimestamps();
        }, 30000); // Refresh every 30 seconds
    }

    refreshData() {
        if (this.currentTab) {
            this.loadTabData(this.currentTab);
        }
        // Also update hashrate data, current block, and miner data
        this.updateTotalHashrate();
        this.updateCurrentBlock();
        this.refreshMinerData();
        this.updateTimestamps();
    }

    async fetchPoolData() {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();

            // Update pool status
            document.getElementById('pool-status').textContent = data.pool?.status || 'Unknown';

            // Update statistics
            this.updatePoolStats(data);

            // Update recent activity
            this.updateRecentActivity(data);

        } catch (error) {
            console.error('Failed to fetch pool data:', error);
            document.getElementById('pool-status').textContent = 'Error';
        }
    }

    updatePoolStats(data) {
        // Update pool status
        if (data.pool) {
            document.getElementById('pool-status').textContent = data.pool.status || 'Online';
        }

        // Update active miners count
        if (data.stratum && data.stratum.connections !== undefined) {
            document.getElementById('active-miners').textContent = data.stratum.connections;
        }

        // Update current block height
        if (data.mining && data.mining.blockHeight) {
            document.getElementById('current-block').textContent = data.mining.blockHeight;
        }

        // Update pool uptime
        if (data.uptime !== undefined) {
            document.getElementById('pool-uptime').textContent = this.formatUptime(data.uptime);
        }

        // Update performance metrics
        if (data.performance) {
            // Blocks found
            if (data.performance.blocksFound !== undefined) {
                document.getElementById('blocks-found').textContent = data.performance.blocksFound;
            }

            // Network difficulty
            if (data.performance.networkDifficulty !== undefined) {
                document.getElementById('network-difficulty').textContent =
                    this.formatDifficulty(data.performance.networkDifficulty);
            }

            // Average block time
            if (data.performance.avgBlockTime !== undefined) {
                // Check if it's already a formatted string or needs formatting
                const avgBlockTime = typeof data.performance.avgBlockTime === 'string'
                    ? data.performance.avgBlockTime
                    : this.formatBlockTime(data.performance.avgBlockTime);
                document.getElementById('avg-block-time').textContent = avgBlockTime;
            }

            // Total paid
            if (data.performance.totalPaid !== undefined) {
                document.getElementById('total-paid').textContent =
                    data.performance.totalPaid.toFixed(2) + ' PAS';
            }

            // Total miners
            if (data.performance.totalMiners !== undefined) {
                document.getElementById('total-miners').textContent = data.performance.totalMiners;
            }
        }
    }

    // Function to update total hashrate from real-time data
    async updateTotalHashrate() {
        try {
            const response = await fetch('/api/miners/hashrate');
            const data = await response.json();

            if (data.totalHashrate !== undefined) {
                const hashrateElement = document.getElementById('total-hashrate');
                if (hashrateElement) {
                    hashrateElement.textContent = this.formatHashrate(data.totalHashrate);
                }
            }

            // Also update the miners table if we're on the miners tab
            if (this.currentTab === 'miners' && data.miners) {
                this.updateMinersTableWithHashrate(data.miners);
            }
        } catch (error) {
            console.error('Failed to fetch hashrate data:', error);
        }
    }

    // Function to update current block height
    async updateCurrentBlock() {
        try {
            const response = await fetch('/api/block-template');
            const data = await response.json();

            if (data.index !== undefined) {
                const blockElement = document.getElementById('current-block');
                if (blockElement) {
                    blockElement.textContent = data.index;
                }
            }
        } catch (error) {
            console.error('Failed to fetch block template:', error);
        }
    }

    // Function to update miners table with real-time hashrate data
    updateMinersTableWithHashrate(realtimeMiners) {
        const container = document.getElementById('miners-table-container');
        if (!container || container.innerHTML.includes('Loading') || container.innerHTML.includes('No miners')) {
            return; // Don't update if table is not loaded yet
        }

        // Get the current table rows
        const table = container.querySelector('table');
        if (!table) return;

        // Update hashrate for each miner in the table
        realtimeMiners.forEach(realtimeMiner => {
            const row = table.querySelector(`tr[data-address="${realtimeMiner.address}"]`);
            if (row) {
                const hashrateCell = row.querySelector('.hashrate');
                if (hashrateCell) {
                    hashrateCell.textContent = this.formatHashrate(realtimeMiner.hashrate || 0);
                }
            }
        });
    }

    // Function to refresh miner data (shares, blocks, etc.)
    async refreshMinerData() {
        if (this.currentTab === 'miners') {
            try {
                const response = await fetch('/api/miners/grouped');
                const data = await response.json();

                if (data.miners) {
                    // Get current hashrate data
                    const hashrateResponse = await fetch('/api/miners/hashrate');
                    const hashrateData = await hashrateResponse.json();

                    // Merge database data with real-time hashrate data
                    const minersWithHashrate = data.miners.map(dbMiner => {
                        const realtimeMiner = hashrateData.miners.find(rt => rt.address === dbMiner.address);
                        return {
                            ...dbMiner,
                            hashrate: realtimeMiner ? realtimeMiner.hashrate : dbMiner.hashrate || 0,
                            // Merge real-time fields for better online detection
                            workerName: realtimeMiner ? realtimeMiner.workerName : dbMiner.worker_name,
                            lastActivity: realtimeMiner ? realtimeMiner.lastActivity : dbMiner.last_seen,
                            isActivelyMining: realtimeMiner ? true : false
                        };
                    });

                    this.updateMinersTable(minersWithHashrate);
                }
            } catch (error) {
                console.error('Failed to refresh miner data:', error);
            }
        }
    }

    updateMinersTable(miners) {
        const container = document.getElementById('miners-table-container');
        if (!container) return;

        if (miners.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #666;">No miners connected</p>';
            return;
        }

        // Store miners data for timestamp updates
        this.currentMinersData = {};
        miners.forEach(miner => {
            this.currentMinersData[miner.address || 'unknown'] = miner;
        });

        const table = `
            <div class="table-wrapper">
                <table class="miners-table enhanced-miners-table">
                    <thead>
                        <tr>
                            <th>Worker Name</th>
                            <th>Wallet Address</th>
                            <th>Hashrate</th>
                            <th>Total Shares</th>
                            <th>Valid Shares</th>
                            <th>Rejected Shares</th>
                            <th>Blocks Found</th>
                            <th>Last Seen</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${miners.map(miner => {
                            const workerName = miner.workerName || miner.worker_name || miner.worker || miner.id || 'Unknown Worker';
                            const isOnline = miner.isActivelyMining || 
                                           (miner.lastActivity && (Date.now() - miner.lastActivity < 120000)) ||
                                           (miner.last_seen && (Date.now() - miner.last_seen < 120000)) ||
                                           (miner.hashrate && miner.hashrate > 0);
                            const totalShares = miner.share_stats ? miner.share_stats.total : (miner.shares || 0);
                            const validShares = miner.share_stats ? miner.share_stats.valid : 0;
                            const rejectedShares = miner.share_stats ? miner.share_stats.rejected : 0;
                            const blocksFound = miner.share_stats ? miner.share_stats.blocks_found : 0;
                            
                            return `
                        <tr data-address="${miner.address || 'unknown'}" class="miner-row ${isOnline ? 'online' : 'offline'}">
                            <td class="worker-name">
                                <div class="worker-info">
                                    <strong class="worker-title">${workerName}</strong>
                                    ${miner.id && miner.id !== workerName ? `<small class="worker-id">${miner.id}</small>` : ''}
                                </div>
                            </td>
                            <td class="wallet-address">
                                <span class="address-text">${miner.address || 'Unknown'}</span>
                            </td>
                            <td class="hashrate-cell">
                                <span class="hashrate">${this.formatHashrate(miner.hashrate || 0)}</span>
                            </td>
                            <td class="shares-total">${totalShares.toLocaleString()}</td>
                            <td class="shares-valid">
                                <span class="valid-count">${validShares.toLocaleString()}</span>
                            </td>
                            <td class="shares-rejected">
                                <span class="rejected-count">${rejectedShares.toLocaleString()}</span>
                            </td>
                            <td class="blocks-found">
                                <span class="blocks-count">${blocksFound.toLocaleString()}</span>
                            </td>
                            <td class="last-seen">${this.formatTimestamp(miner.last_seen)}</td>
                            <td class="status-cell">
                                <div class="status-display ${isOnline ? 'status-online' : 'status-offline'}">
                                    <span class="status-indicator ${isOnline ? 'online' : 'offline'}"></span>
                                    <span class="status-text">${isOnline ? 'Online' : 'Offline'}</span>
                                </div>
                            </td>
                        </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = table;
    }

    formatHashrate(hashrate) {
        if (!hashrate || hashrate === 0 || isNaN(hashrate)) return '0 H/s';

        const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s'];
        let value = parseFloat(hashrate);
        let unitIndex = 0;

        while (value >= 1000 && unitIndex < units.length - 1) {
            value /= 1000;
            unitIndex++;
        }

        return `${value.toFixed(2)} ${units[unitIndex]}`;
    }

    formatUptime(seconds) {
        if (!seconds) return '-';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (hours > 24) {
            const days = Math.floor(hours / 24);
            return `${days}d ${hours % 24}h`;
        }

        return `${hours}h ${minutes}m`;
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return '-';

        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) { // Less than 1 minute
            return 'Just now';
        } else if (diff < 3600000) { // Less than 1 hour
            const minutes = Math.floor(diff / 60000);
            return `${minutes}m ago`;
        } else if (diff < 86400000) { // Less than 1 day
            const hours = Math.floor(diff / 3600000);
            return `${hours}h ago`;
        } else {
            const days = Math.floor(diff / 86400000);
            return `${days}d ago`;
        }
    }

    formatDifficulty(difficulty) {
        if (!difficulty || difficulty === 0 || isNaN(difficulty)) return '1.00';

        if (difficulty >= 1000000) {
            return (difficulty / 1000000).toFixed(2) + 'M';
        } else if (difficulty >= 1000) {
            return (difficulty / 1000).toFixed(2) + 'K';
        } else {
            return difficulty.toFixed(2);
        }
    }

    formatBlockTime(seconds) {
        if (!seconds || seconds === 0 || isNaN(seconds)) return '~10m';

        if (seconds >= 3600) { // 1 hour or more
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        } else if (seconds >= 60) { // 1 minute or more
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
        } else {
            return `${seconds}s`;
        }
    }

    // Function to update all timestamps in the miners table
    updateTimestamps() {
        const container = document.getElementById('miners-table-container');
        if (!container || container.innerHTML.includes('Loading') || container.innerHTML.includes('No miners')) {
            return;
        }

        const table = container.querySelector('table');
        if (!table) return;

        // Update all timestamp cells
        const timestampCells = table.querySelectorAll('td:nth-child(8)'); // 8th column is last seen
        timestampCells.forEach(cell => {
            const row = cell.closest('tr');
            const address = row.getAttribute('data-address');

            // Find the miner data to get the original timestamp
            if (this.currentMinersData && this.currentMinersData[address]) {
                const miner = this.currentMinersData[address];
                cell.textContent = this.formatTimestamp(miner.last_seen);
            }
        });
    }

    updateRecentActivity(data) {
        const container = document.getElementById('recent-activity');
        if (!container) return;

        if (!data.recentActivity || data.recentActivity.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #666;">No recent activity</p>';
            return;
        }

        const activityHtml = data.recentActivity.map(activity => `
            <div style="padding: 15px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #ec9be7; font-weight: 600;">${activity.type}</span>
                    <span style="color: #b8b8b8; font-size: 0.9rem;">${this.formatTimestamp(activity.timestamp)}</span>
                </div>
                <div style="color: #ffffff; margin-top: 5px;">${activity.description}</div>
            </div>
        `).join('');

        container.innerHTML = activityHtml;
    }

    async fetchMinersData() {
        try {
            // First try the grouped API, fallback to regular miners API
            let minersData;
            let hashrateData;

            try {
                const [minersResponse, hashrateResponse] = await Promise.all([
                    fetch('/api/miners/grouped'),
                    fetch('/api/miners/hashrate')
                ]);
                minersData = await minersResponse.json();
                hashrateData = await hashrateResponse.json();
            } catch (groupedError) {
                console.log('Grouped miners not available, using regular miners API');
                // Fallback to regular miners API
                const [minersResponse, hashrateResponse] = await Promise.all([
                    fetch('/api/miners'),
                    fetch('/api/miners/hashrate')
                ]);
                minersData = await minersResponse.json();
                hashrateData = await hashrateResponse.json();
            }

            if (minersData.miners && minersData.miners.length > 0) {
                // Merge database data with real-time hashrate data
                const minersWithHashrate = minersData.miners.map(dbMiner => {
                    const realtimeMiner = hashrateData.miners.find(rt => rt.address === dbMiner.address);
                    return {
                        ...dbMiner,
                        hashrate: realtimeMiner ? realtimeMiner.hashrate : dbMiner.hashrate || 0,
                        // Merge real-time fields for better online detection
                        workerName: realtimeMiner ? realtimeMiner.workerName : dbMiner.worker_name,
                        lastActivity: realtimeMiner ? realtimeMiner.lastActivity : dbMiner.last_seen,
                        isActivelyMining: realtimeMiner ? true : false
                    };
                });

                this.updateMinersTable(minersWithHashrate);
            } else if (hashrateData.miners && hashrateData.miners.length > 0) {
                // If no database miners but we have active hashrate data, show that
                this.updateMinersTable(hashrateData.miners);
            } else {
                document.getElementById('miners-table-container').innerHTML =
                    '<div class="loading-message">No miners currently connected</div>';
            }
        } catch (error) {
            console.error('Failed to fetch miners data:', error);
            document.getElementById('miners-table-container').innerHTML =
                '<div class="error-message">Failed to load miners data</div>';
        }
    }

    async fetchBlocksData() {
        try {
            const response = await fetch('/api/blocks');
            const data = await response.json();

            const container = document.getElementById('blocks-table-container');
            if (!container) return;

            if (data.blocks && data.blocks.length > 0) {
                const blocksHtml = `
                    <div class="blocks-table-wrapper">
                        <table class="enhanced-blocks-table">
                            <thead>
                                <tr>
                                    <th>Height</th>
                                    <th>Hash</th>
                                    <th>Found By</th>
                                    <th>Block Reward</th>
                                    <th>Difficulty</th>
                                    <th>Timestamp</th>
                                    <th>Confirmations</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.blocks.map(block => {
                                    const confirmations = this.calculateConfirmations(block);
                                    const blockReward = this.calculateBlockReward(block.height);
                                    const statusDisplay = this.renderBlockStatus(confirmations, block.status);
                                    
                                    return `
                                    <tr class="block-row ${confirmations >= 10 ? 'confirmed' : 'pending'}">
                                        <td class="block-height">${block.height}</td>
                                        <td class="block-hash">
                                            <span class="hash-text">${block.hash.substring(0, 16)}...</span>
                                        </td>
                                        <td class="found-by">
                                            <span class="address-text">${block.found_by}</span>
                                        </td>
                                        <td class="block-reward">
                                            <span class="reward-amount">${blockReward} PAS</span>
                                        </td>
                                        <td class="block-difficulty">${block.difficulty.toLocaleString()}</td>
                                        <td class="block-timestamp">${this.formatTimestamp(block.timestamp)}</td>
                                        <td class="confirmations-cell">
                                            ${statusDisplay}
                                        </td>
                                    </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
                container.innerHTML = blocksHtml;
            } else {
                container.innerHTML = '<div class="no-blocks-message">No blocks found yet</div>';
            }
        } catch (error) {
            console.error('Failed to fetch blocks data:', error);
            const container = document.getElementById('blocks-table-container');
            if (container) {
                container.innerHTML = '<div class="error-message">Failed to load blocks data</div>';
            }
        }
    }

    calculateConfirmations(block) {
        // Get current blockchain height from the overview stats
        const currentBlockElement = document.getElementById('current-block');
        const currentBlockHeight = currentBlockElement ? parseInt(currentBlockElement.textContent) : 0;
        
        // Calculate confirmations as the difference between current height and block height
        const confirmations = Math.max(0, currentBlockHeight - block.height);
        
        return confirmations;
    }

    calculateBlockReward(height) {
        // Standard block reward for Pastella (adjust as needed)
        const baseReward = 50.0; // Base reward in PAS
        
        // You can implement halving logic here if needed
        // For now, return fixed reward
        return baseReward.toFixed(2);
    }

    renderBlockStatus(confirmations, blockStatus) {
        const minConfirmations = 10;
        
        if (confirmations < minConfirmations) {
            // Show spinning animation with confirmation count
            return `
                <div class="confirmation-pending">
                    <div class="spinner"></div>
                    <span class="confirmation-count">${confirmations}/${minConfirmations}</span>
                </div>
            `;
        } else {
            // Show final status - blocks with enough confirmations are considered valid unless explicitly marked as invalid
            const isValid = blockStatus !== 'invalid' && blockStatus !== 'rejected';
            return `
                <div class="confirmation-final ${isValid ? 'valid' : 'invalid'}">
                    <span class="status-icon ${isValid ? 'valid' : 'invalid'}"></span>
                    <span class="confirmation-text">${isValid ? 'Confirmed' : 'Invalid'}</span>
                </div>
            `;
        }
    }

    async fetchPaymentsData() {
        try {
            const response = await fetch('/api/payments');
            const data = await response.json();

            const container = document.getElementById('payments-table-container');
            if (!container) return;

            if (data.payments && data.payments.length > 0) {
                const blockExplorer = data.blockExplorer || 'http://127.0.0.1:3004';

                const paymentsHtml = `
                    <table>
                        <thead>
                            <tr>
                                <th>Address</th>
                                <th>Amount</th>
                                <th>Transaction ID</th>
                                <th>Timestamp</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.payments.map(payment => {
                                const txId = payment.txId || payment.transactionId || '';
                                const isFailedTx = payment.status === 'failed';

                                let txIdDisplay;
                                if (isFailedTx) {
                                    txIdDisplay = '-';
                                } else if (txId) {
                                    const shortTxId = txId.substring(0, 16) + '...';
                                    txIdDisplay = `<a href="${blockExplorer}/tx/${txId}" target="_blank" style="font-family: 'Courier New', monospace; background: rgba(236, 155, 231, 0.1); padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; color: #ff9ed9; border: 1px solid rgba(236, 155, 231, 0.2); text-decoration: none;">${shortTxId}</a>`;
                                } else {
                                    txIdDisplay = '-';
                                }

                                return `
                                    <tr>
                                        <td style="font-family: monospace; font-size: 0.9rem;">${(payment.address || payment.minerAddress || '').substring(0, 16)}...</td>
                                        <td>${payment.amount} PAS</td>
                                        <td>${txIdDisplay}</td>
                                        <td>${this.formatTimestamp(payment.timestamp || payment.createdAt)}</td>
                                        <td>
                                            <span class="status-indicator ${payment.status === 'confirmed' ? 'status-online' : 'status-offline'}"></span>
                                            ${payment.status}
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                `;
                container.innerHTML = paymentsHtml;
            } else {
                container.innerHTML = '<p style="text-align: center; color: #666;">No payments yet</p>';
            }
        } catch (error) {
            console.error('Failed to fetch payments data:', error);
            const container = document.getElementById('payments-table-container');
            if (container) {
                container.innerHTML = '<div class="error">Failed to load payments data</div>';
            }
        }
    }

    async fetchStatsData() {
        try {
            const response = await fetch('/api/pool-stats');
            const data = await response.json();

            const container = document.getElementById('stats-container');
            if (!container) return;

            if (data) {
                // Check if we have the new compact statistics layout
                if (document.getElementById('stats-hashrate')) {
                    // Use new compact statistics layout
                    updateCompactStatistics(data);
                } else {
                    // Use old statistics layout
                    const statsHtml = `
                        <div class="enhanced-metric-card">
                            <div class="enhanced-metric-value">${data.stratum.connections}</div>
                            <div class="enhanced-metric-label">Active Miners</div>
                        </div>
                        <div class="enhanced-metric-card">
                            <div class="enhanced-metric-value">${(data.shares.rate || 0).toFixed(1)}%</div>
                            <div class="enhanced-metric-label">Success Rate</div>
                        </div>
                        <div class="enhanced-metric-card">
                            <div class="enhanced-metric-value">${data.blocks.found || 0}</div>
                            <div class="enhanced-metric-label">Blocks Found</div>
                        </div>
                        <div class="enhanced-metric-card">
                            <div class="enhanced-metric-value">${Math.floor(data.uptime / 60)}m</div>
                            <div class="enhanced-metric-label">Pool Uptime</div>
                        </div>
                        <div class="enhanced-metric-card">
                            <div class="enhanced-metric-value">${data.mining.poolDifficulty || 1}</div>
                            <div class="enhanced-metric-label">Pool Difficulty</div>
                        </div>
                        <div class="enhanced-metric-card">
                            <div class="enhanced-metric-value">${(data.mining.blockDifficulty || 0).toLocaleString()}</div>
                            <div class="enhanced-metric-label">Network Diff</div>
                        </div>
                    `;
                    container.innerHTML = statsHtml;

                    // Also populate performance and network metrics
                    this.updatePerformanceMetrics(data);
                    this.updateNetworkMetrics(data);
                }
            } else {
                container.innerHTML = '<div class="error-message">Failed to load statistics</div>';
            }
        } catch (error) {
            console.error('Failed to fetch statistics data:', error);
            const container = document.getElementById('stats-container');
            if (container) {
                container.innerHTML = '<div class="error-message">Failed to load statistics</div>';
            }
        }
    }

    updatePerformanceMetrics(data) {
        const container = document.getElementById('performance-metrics');
        if (!container) return;

        const performanceHtml = `
            <div class="enhanced-metric-card">
                <div class="enhanced-metric-value">${data.shares.valid || 0}</div>
                <div class="enhanced-metric-label">Valid Shares</div>
            </div>
            <div class="enhanced-metric-card">
                <div class="enhanced-metric-value">${data.shares.invalid || 0}</div>
                <div class="enhanced-metric-label">Invalid Shares</div>
            </div>
            <div class="enhanced-metric-card">
                <div class="enhanced-metric-value">${data.stratum.totalConnections || 0}</div>
                <div class="enhanced-metric-label">Total Conns</div>
            </div>
            <div class="enhanced-metric-card">
                <div class="enhanced-metric-value">${data.stratum.jobs || 0}</div>
                <div class="enhanced-metric-label">Active Jobs</div>
            </div>
        `;
        container.innerHTML = performanceHtml;
    }

    updateNetworkMetrics(data) {
        const container = document.getElementById('network-metrics');
        if (!container) return;

        const lastBlockTime = data.blocks.lastFound ? formatTimeAgo(data.blocks.lastFound) : 'Never';
        const networkHtml = `
            <div class="enhanced-metric-card">
                <div class="enhanced-metric-value">${data.mining.template ? data.mining.template.index : 'N/A'}</div>
                <div class="enhanced-metric-label">Block Height</div>
            </div>
            <div class="enhanced-metric-card">
                <div class="enhanced-metric-value">${lastBlockTime}</div>
                <div class="enhanced-metric-label">Last Block</div>
            </div>
            <div class="enhanced-metric-card">
                <div class="enhanced-metric-value">${data.pool.algorithm.toUpperCase()}</div>
                <div class="enhanced-metric-label">Algorithm</div>
            </div>
            <div class="enhanced-metric-card">
                <div class="enhanced-metric-value">${(data.pool.fee * 100).toFixed(1)}%</div>
                <div class="enhanced-metric-label">Pool Fee</div>
            </div>
        `;
        container.innerHTML = networkHtml;
    }

    // New enhanced methods for additional features

    async fetchAnalyticsData(timeRange = '24h') {
        try {
            const response = await fetch(`/api/analytics?range=${timeRange}`);
            const data = await response.json();

            const container = document.getElementById('analytics-container');
            if (!container) return;

            if (data) {
                this.renderAnalytics(data);
            } else {
                container.innerHTML = '<div class="error">Failed to load analytics</div>';
            }
        } catch (error) {
            console.error('Failed to fetch analytics data:', error);
            const container = document.getElementById('analytics-container');
            if (container) {
                container.innerHTML = '<div class="error">Failed to load analytics</div>';
            }
        }
    }

    renderAnalytics(data) {
        const container = document.getElementById('analytics-container');
        if (!container) return;

        const analyticsHtml = `
            <div class="time-selector">
                <button class="time-btn ${data.timeRange === '1h' ? 'active' : ''}" onclick="dashboard.fetchAnalyticsData('1h')">1H</button>
                <button class="time-btn ${data.timeRange === '6h' ? 'active' : ''}" onclick="dashboard.fetchAnalyticsData('6h')">6H</button>
                <button class="time-btn ${data.timeRange === '24h' ? 'active' : ''}" onclick="dashboard.fetchAnalyticsData('24h')">24H</button>
                <button class="time-btn ${data.timeRange === '7d' ? 'active' : ''}" onclick="dashboard.fetchAnalyticsData('7d')">7D</button>
                <button class="time-btn ${data.timeRange === '30d' ? 'active' : ''}" onclick="dashboard.fetchAnalyticsData('30d')">30D</button>
            </div>

            <div class="analytics-grid">
                <div class="metric-card">
                    <div class="metric-title">Current Hashrate</div>
                    <div class="metric-value">${this.formatHashrate(data.current.hashrate)}</div>
                    <div class="metric-change neutral">Real-time</div>
                </div>
                <div class="metric-card">
                    <div class="metric-title">Pool Efficiency</div>
                    <div class="metric-value">${data.current.efficiency}%</div>
                    <div class="metric-change ${data.current.efficiency > 95 ? 'positive' : 'neutral'}">
                        ${data.historical.shares.efficiency}% avg
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-title">Active Miners</div>
                    <div class="metric-value">${data.current.miners}</div>
                    <div class="metric-change neutral">${data.historical.miners.unique} unique</div>
                </div>
                <div class="metric-card">
                    <div class="metric-title">Blocks Found</div>
                    <div class="metric-value">${data.historical.blocks.found}</div>
                    <div class="metric-change neutral">${data.historical.blocks.rate.toFixed(4)}/hr</div>
                </div>
            </div>

            <div class="chart-container">
                <div class="chart-title">Hashrate Trend (${data.timeRange.toUpperCase()})</div>
                <canvas id="hashrate-chart" width="400" height="200"></canvas>
            </div>
        `;

        container.innerHTML = analyticsHtml;

        // Render hashrate chart if chart library is available
        this.renderHashrateChart(data.historical.hashrate.points);
    }

    renderHashrateChart(hashratePoints) {
        // Simple canvas-based chart rendering
        const canvas = document.getElementById('hashrate-chart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        if (hashratePoints.length < 2) return;

        // Find min/max for scaling
        const hashrates = hashratePoints.map(p => p.hashrate || 0);
        const minHashrate = Math.min(...hashrates);
        const maxHashrate = Math.max(...hashrates);
        const range = maxHashrate - minHashrate || 1;

        // Draw grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 5; i++) {
            const y = (height / 5) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Draw line
        ctx.strokeStyle = '#ec9be7';
        ctx.lineWidth = 2;
        ctx.beginPath();

        hashratePoints.forEach((point, index) => {
            const x = (index / (hashratePoints.length - 1)) * width;
            const y = height - ((point.hashrate - minHashrate) / range) * height;
            
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

        // Draw points
        ctx.fillStyle = '#ff6b9d';
        hashratePoints.forEach((point, index) => {
            const x = (index / (hashratePoints.length - 1)) * width;
            const y = height - ((point.hashrate - minHashrate) / range) * height;
            
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
        });
    }

    async fetchLeaderboardData(timeRange = '24h') {
        try {
            const response = await fetch(`/api/leaderboard?range=${timeRange}&limit=20`);
            const data = await response.json();

            const container = document.getElementById('leaderboard-container');
            if (!container) return;

            if (data.leaderboard && data.leaderboard.length > 0) {
                const leaderboardHtml = `
                    <div class="time-selector">
                        <button class="time-btn ${timeRange === '1h' ? 'active' : ''}" onclick="dashboard.fetchLeaderboardData('1h')">1H</button>
                        <button class="time-btn ${timeRange === '24h' ? 'active' : ''}" onclick="dashboard.fetchLeaderboardData('24h')">24H</button>
                        <button class="time-btn ${timeRange === '7d' ? 'active' : ''}" onclick="dashboard.fetchLeaderboardData('7d')">7D</button>
                        <button class="time-btn ${timeRange === '30d' ? 'active' : ''}" onclick="dashboard.fetchLeaderboardData('30d')">30D</button>
                    </div>
                    <div style="margin-bottom: 20px; text-align: center; color: #b8b8b8;">
                        ${data.onlineMiners} online / ${data.totalMiners} total miners
                    </div>
                    ${data.leaderboard.map(miner => `
                        <div class="leaderboard-item">
                            <div class="rank ${miner.rank <= 3 ? 'top-3' : ''}">#${miner.rank}</div>
                            <div class="miner-info">
                                <div class="miner-name">
                                    ${miner.workerName || 'Anonymous'}
                                    ${miner.isOnline ? '<span class="status-indicator status-online"></span>' : '<span class="status-indicator status-offline"></span>'}
                                </div>
                                <div class="miner-stats">
                                    ${this.formatHashrate(miner.hashrate)} • 
                                    ${miner.shares.valid}/${miner.shares.total} shares (${miner.shares.efficiency}%) • 
                                    ${miner.blocks} blocks
                                </div>
                            </div>
                        </div>
                    `).join('')}
                `;
                container.innerHTML = leaderboardHtml;
            } else {
                container.innerHTML = '<p style="text-align: center; color: #666;">No miners found</p>';
            }
        } catch (error) {
            console.error('Failed to fetch leaderboard data:', error);
            const container = document.getElementById('leaderboard-container');
            if (container) {
                container.innerHTML = '<div class="error">Failed to load leaderboard</div>';
            }
        }
    }

    async fetchNetworkData() {
        try {
            const response = await fetch('/api/network');
            const data = await response.json();

            const container = document.getElementById('network-container');
            if (!container) return;

            if (data) {
                const networkHtml = `
                    <div class="network-status ${data.daemon.connected ? 'connected' : 'disconnected'}">
                        <div class="network-indicator ${data.daemon.connected ? 'online' : 'offline'}"></div>
                        <div>
                            <strong>Daemon Connection:</strong> 
                            ${data.daemon.connected ? 'Connected' : 'Disconnected'}
                            ${data.daemon.error ? `(${data.daemon.error})` : ''}
                        </div>
                    </div>

                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-value">${data.blockchain.height}</div>
                            <div class="stat-label">Block Height</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${data.blockchain.difficulty}</div>
                            <div class="stat-label">Network Difficulty</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${this.formatHashrate(data.pool.hashrate)}</div>
                            <div class="stat-label">Pool Hashrate</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${data.pool.poolPercentage}%</div>
                            <div class="stat-label">Network Share</div>
                        </div>
                    </div>

                    <div class="block-info">
                        <h4>Network Information</h4>
                        <div class="block-details">
                            <div class="block-detail">
                                <div class="label">Pending Transactions</div>
                                <div class="value">${data.blockchain.pendingTransactions}</div>
                            </div>
                            <div class="block-detail">
                                <div class="label">Network Hashrate</div>
                                <div class="value">${this.formatHashrate(data.pool.networkHashrate)}</div>
                            </div>
                            <div class="block-detail">
                                <div class="label">Last Block</div>
                                <div class="value">${this.formatTimestamp(data.blockchain.lastBlock)}</div>
                            </div>
                        </div>
                    </div>
                `;
                container.innerHTML = networkHtml;
            } else {
                container.innerHTML = '<div class="error">Failed to load network data</div>';
            }
        } catch (error) {
            console.error('Failed to fetch network data:', error);
            const container = document.getElementById('network-container');
            if (container) {
                container.innerHTML = '<div class="error">Failed to load network data</div>';
            }
        }
    }

    async fetchActivityData() {
        try {
            const response = await fetch('/api/activity?limit=50');
            const data = await response.json();

            const container = document.getElementById('activity-container');
            if (!container) return;

            if (data.activities && data.activities.length > 0) {
                const activityHtml = data.activities.map(activity => `
                    <div class="activity-item">
                        <div class="activity-icon ${activity.type === 'block_found' ? 'block' : 'share'}">
                            ${activity.type === 'block_found' ? 'B' : 'S'}
                        </div>
                        <div class="activity-content">
                            <div class="activity-description">${activity.description}</div>
                            <div class="activity-meta">
                                ${activity.miner} • ${this.formatTimestamp(activity.timestamp)}
                            </div>
                        </div>
                    </div>
                `).join('');

                container.innerHTML = activityHtml;
            } else {
                container.innerHTML = '<p style="text-align: center; color: #666;">No recent activity</p>';
            }
        } catch (error) {
            console.error('Failed to fetch activity data:', error);
            const container = document.getElementById('activity-container');
            if (container) {
                container.innerHTML = '<div class="error">Failed to load activity</div>';
            }
        }
    }
}

// Global functions for onclick handlers
function showTab(tabName, event) {
    if (window.dashboard) {
        window.dashboard.showTab(tabName, event);
    }
}

function refreshData() {
    if (window.dashboard) {
        window.dashboard.refreshData();
    }
}

// Track if we're currently looking up a miner to prevent duplicate calls
let isCurrentlyLookingUp = false;

// Enhanced miner lookup functionality with localStorage
async function lookupMiner() {
    const addressInput = document.getElementById('address-input');
    const address = addressInput.value.trim();
    
    if (!address) {
        alert('Please enter a wallet address');
        return;
    }
    
    // Set lookup flag to prevent duplicate calls
    isCurrentlyLookingUp = true;

    // Save address to localStorage for persistence
    localStorage.setItem('pastellaMiningPoolWalletAddress', address);

    const resultsDiv = document.getElementById('lookup-results');
    const errorDiv = document.getElementById('lookup-error');
    
    // Hide previous results and show loading
    resultsDiv.classList.remove('show');
    errorDiv.style.display = 'none';
    
    // Show loading states
    const sharesTable = document.getElementById('lookup-shares-table');
    const workersTable = document.getElementById('lookup-workers-table');
    if (sharesTable) sharesTable.innerHTML = '<div class="loading-message">Loading shares...</div>';
    if (workersTable) workersTable.innerHTML = '<div class="loading-message">Loading workers...</div>';
    
    try {
        // Fetch miner data
        const response = await fetch(`/api/miners/address/${encodeURIComponent(address)}`);
        
        if (response.status === 404) {
            errorDiv.style.display = 'block';
            return;
        }
        
        if (!response.ok) {
            throw new Error('Failed to fetch miner data');
        }
        
        const data = await response.json();
        
        // Update enhanced statistics with improved hashrate display
        updateHashrateCards(data);
        document.getElementById('lookup-confirmed-balance').textContent = formatBalance(data.confirmed_balance || 0) + ' PAS';
        document.getElementById('lookup-unconfirmed-balance').textContent = formatBalance(data.unconfirmed_balance || 0) + ' PAS';
        document.getElementById('lookup-total-paid').textContent = formatBalance(data.total_paid || 0) + ' PAS';
        document.getElementById('lookup-workers-online').textContent = data.worker_count || 0;
        document.getElementById('lookup-shares').textContent = (data.total_shares || 0).toLocaleString();
        document.getElementById('lookup-blocks-found').textContent = data.blocks_found || 0;
        
        // Update per-block rewards table
        await updatePerBlockRewards(address);
        
        // Update workers table (preserve table structure, only update values)
        updateWorkersTable(data.workers || [], data.is_online);
        
        // Update shares table (preserve table structure, only update values)
        updateSharesTable(data.recent_shares || []);
        
        resultsDiv.classList.add('show');
        
    } catch (error) {
        console.error('Error looking up miner:', error);
        errorDiv.innerHTML = 'Error fetching miner data. Please try again.';
        errorDiv.style.display = 'block';
        
        // Clear loading states even on error
        updateSharesTable([]);
        updateWorkersTable([], false);
    } finally {
        // Clear the lookup flag
        isCurrentlyLookingUp = false;
    }
}

// Refresh miner lookup data without rebuilding the entire UI
async function refreshMinerLookupData(address) {
    try {
        // Just update the data in the existing UI structure
        const [minerResponse, rewardsResponse] = await Promise.all([
            fetch(`/api/miners/address/${encodeURIComponent(address)}`),
            fetch(`/api/miners/address/${encodeURIComponent(address)}/rewards`)
        ]);
        
        if (minerResponse.ok) {
            const data = await minerResponse.json();
            
            // Update enhanced statistics (just the values)
            updateHashrateCards(data);
            document.getElementById('lookup-confirmed-balance').textContent = formatBalance(data.confirmed_balance || 0) + ' PAS';
            document.getElementById('lookup-unconfirmed-balance').textContent = formatBalance(data.unconfirmed_balance || 0) + ' PAS';
            document.getElementById('lookup-total-paid').textContent = formatBalance(data.total_paid || 0) + ' PAS';
            document.getElementById('lookup-workers-online').textContent = data.worker_count || 0;
            document.getElementById('lookup-shares').textContent = (data.total_shares || 0).toLocaleString();
            document.getElementById('lookup-blocks-found').textContent = data.blocks_found || 0;
            
            // Update workers and shares tables (preserve structure)
            updateWorkersTable(data.workers || [], data.is_online);
            updateSharesTable(data.recent_shares || []);
        }
        
        if (rewardsResponse.ok) {
            const rewardsData = await rewardsResponse.json();
            
            // Update per-block rewards table (preserve structure)
            updatePerBlockRewardsTable(rewardsData.rewards || []);
        }
    } catch (error) {
        console.error('Error refreshing miner lookup data:', error);
    }
}

// Load saved wallet address on page load
function loadSavedWalletAddress(forceRefresh = false) {
    const savedAddress = localStorage.getItem('pastellaMiningPoolWalletAddress');
    if (savedAddress) {
        const addressInput = document.getElementById('address-input');
        if (addressInput) {
            addressInput.value = savedAddress;
            
            // Check if we already have results displayed
            const resultsDiv = document.getElementById('lookup-results');
            const hasResults = resultsDiv && resultsDiv.classList.contains('show');
            
            // Only auto-lookup if we don't have results or if forced refresh
            if (!hasResults || forceRefresh) {
                // Only auto-lookup once per page load, not on every tab switch
                setTimeout(() => {
                    if (!isCurrentlyLookingUp) {
                        lookupMiner();
                    }
                }, 1000);
            } else if (hasResults && !forceRefresh) {
                // Just refresh the data without rebuilding everything
                setTimeout(() => {
                    refreshMinerLookupData(savedAddress);
                }, 100);
            }
        }
    }
}

// Mining tab switching function
function showMiningTab(tabName, event) {
    // Remove active class from all mini-tabs
    const miniTabs = document.querySelectorAll('.mini-tab');
    miniTabs.forEach(tab => tab.classList.remove('active'));
    
    // Add active class to clicked tab
    event.target.classList.add('active');
    
    // Hide all mining tab content
    const tabContents = document.querySelectorAll('.mining-tab-content');
    tabContents.forEach(content => content.classList.remove('active'));
    
    // Show selected tab content
    const selectedContent = document.getElementById(`mining-${tabName}`);
    if (selectedContent) {
        selectedContent.classList.add('active');
    }
    
    // Load specific data based on tab
    if (tabName === 'payouts') {
        loadPayoutsData();
    } else if (tabName === 'rewards') {
        calculateRewardsPercentage();
    }
}

// Load payouts data
async function loadPayoutsData() {
    const address = document.getElementById('address-input').value;
    if (!address) return;

    const payoutsTable = document.getElementById('lookup-payouts-table');

    try {
        // Fetch payment history for this specific miner
        const response = await fetch(`/api/payments?address=${encodeURIComponent(address)}&limit=20`);
        const data = await response.json();

        if (data.payments && data.payments.length > 0) {
            const blockExplorer = data.blockExplorer || 'http://127.0.0.1:3004';

            const payoutsHtml = `
                <table class="payouts-table">
                    <thead>
                        <tr>
                            <th>Amount</th>
                            <th>Transaction ID</th>
                            <th>Timestamp</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.payments.map(payment => {
                            const txId = payment.txId || payment.transactionId || '';
                            const isFailedTx = payment.status === 'failed';

                            let txIdDisplay;
                            if (isFailedTx) {
                                txIdDisplay = '-';
                            } else if (txId) {
                                const shortTxId = txId.substring(0, 16) + '...';
                                txIdDisplay = `<a href="${blockExplorer}/tx/${txId}" target="_blank" style="font-family: 'Courier New', monospace; background: rgba(236, 155, 231, 0.1); padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; color: #ff9ed9; border: 1px solid rgba(236, 155, 231, 0.2); text-decoration: none;">${shortTxId}</a>`;
                            } else {
                                txIdDisplay = '-';
                            }

                            return `
                                <tr>
                                    <td>${payment.amount} PAS</td>
                                    <td>${txIdDisplay}</td>
                                    <td>${window.dashboard.formatTimestamp(payment.timestamp || payment.createdAt)}</td>
                                    <td>
                                        <span class="status-indicator ${payment.status === 'confirmed' ? 'status-online' : 'status-offline'}"></span>
                                        ${payment.status}
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
            payoutsTable.innerHTML = payoutsHtml;
        } else {
            payoutsTable.innerHTML = '<div class="no-data-message">No payouts yet. Payouts are processed automatically when you reach the minimum threshold of 0.001 PAS.</div>';
        }
    } catch (error) {
        console.error('Failed to fetch payouts data:', error);
        payoutsTable.innerHTML = '<div class="error">Failed to load payouts data</div>';
    }
}

// Calculate rewards percentage based on current stats
function calculateRewardsPercentage() {
    const address = document.getElementById('address-input').value;
    if (!address) return;
    
    // Get current hashrate and calculate estimated percentage
    const currentHashrateElement = document.getElementById('lookup-current-hashrate');
    const currentHashrate = parseFloat(currentHashrateElement?.textContent.replace(/[^\d.]/g, '') || '0');
    
    // Get total pool hashrate (simplified calculation)
    const totalHashrateElement = document.getElementById('total-hashrate');
    const totalHashrateText = totalHashrateElement?.textContent || '0 H/s';
    const totalHashrate = parseFloat(totalHashrateText.replace(/[^\d.]/g, ''));
    
    let percentage = 0;
    if (totalHashrate > 0) {
        percentage = ((currentHashrate / totalHashrate) * 100).toFixed(4);
    }
    
    // Note: your-percentage element no longer exists after UI reorganization
    // This calculation could be displayed elsewhere if needed
}

// Update per-block rewards table
async function updatePerBlockRewards(address) {
    try {
        const response = await fetch(`/api/miners/address/${encodeURIComponent(address)}/rewards`);
        if (response.ok) {
            const rewardsData = await response.json();
            
            // Update per-block rewards table (now in Rewards tab)
            updatePerBlockRewardsTable(rewardsData.rewards || []);
        } else {
            // Show empty state
            updatePerBlockRewardsTable([]);
        }
    } catch (error) {
        console.error('Error fetching per-block rewards:', error);
        // Show empty state on error
        updatePerBlockRewardsTable([]);
    }
}


// Update the per-block rewards table with data (preserve structure)
function updatePerBlockRewardsTable(rewards) {
    const container = document.getElementById('per-block-rewards-container');
    if (!container) return;

    if (rewards.length === 0) {
        container.innerHTML = `
            <div class="no-rewards">
                <p>No block rewards found yet.</p>
                <p>Keep mining to earn your first rewards!</p>
            </div>
        `;
        return;
    }

    // Limit to last 50 rewards
    const limitedRewards = rewards.slice(0, 50);

    // Check if table structure exists, if not create it
    let wrapper = container.querySelector('.rewards-table-wrapper');
    if (!wrapper) {
        container.innerHTML = `
            <div class="rewards-table-wrapper">
                <table class="per-block-rewards-table">
                    <thead>
                        <tr>
                            <th>Block Height</th>
                            <th>Block Hash</th>
                            <th>Your Reward</th>
                            <th>Your %</th>
                            <th>Status</th>
                            <th>Time</th>
                        </tr>
                    </thead>
                    <tbody>
                    </tbody>
                </table>
            </div>
        `;
        wrapper = container.querySelector('.rewards-table-wrapper');
    }

    const table = wrapper.querySelector('table');
    const tbody = table.querySelector('tbody');

    // Update existing rows or add new ones
    limitedRewards.forEach((reward, index) => {
        const timeAgo = formatTimeAgo(reward.timestamp);
        const statusClass = reward.block_status === 'confirmed' ? 'confirmed' : 'pending';
        
        let row = tbody.children[index];
        if (!row) {
            row = tbody.insertRow();
            row.className = 'reward-row';
            row.innerHTML = `
                <td class="block-height"></td>
                <td class="block-hash"></td>
                <td class="reward-amount"><span class="amount"></span></td>
                <td class="reward-percentage"></td>
                <td class="reward-status"><span class="status-badge"></span></td>
                <td class="reward-time"></td>
            `;
        }
        
        // Update row values
        row.cells[0].textContent = reward.block_height;
        row.cells[1].textContent = reward.block_hash;
        row.cells[1].title = reward.block_hash;
        row.cells[2].querySelector('.amount').textContent = formatBalance(reward.miner_reward) + ' PAS';
        row.cells[3].textContent = reward.miner_percentage.toFixed(2) + '%';
        
        const statusBadge = row.cells[4].querySelector('.status-badge');
        statusBadge.className = `status-badge ${statusClass}`;
        statusBadge.textContent = reward.block_status || 'pending';
        
        row.cells[5].textContent = timeAgo;
        row.cells[5].setAttribute('data-timestamp', reward.timestamp);
    });

    // Remove extra rows if rewards array is smaller (limited to 50)
    while (tbody.children.length > limitedRewards.length) {
        tbody.removeChild(tbody.lastChild);
    }
}

// Format balance with proper decimal places
function formatBalance(balance) {
    return (balance || 0).toFixed(6);
}

// Format time ago
function formatTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
}

// Update compact statistics page
function updateCompactStatistics(data) {
    // Update main statistics
    const hashrateEl = document.getElementById('stats-hashrate');
    const minersEl = document.getElementById('stats-miners');
    const blocksEl = document.getElementById('stats-blocks');
    const efficiencyEl = document.getElementById('stats-efficiency');
    
    if (hashrateEl) hashrateEl.textContent = formatHashrate(data.mining?.poolHashrate || 0);
    if (minersEl) minersEl.textContent = data.stratum?.connections || 0;
    if (blocksEl) blocksEl.textContent = data.blocks?.found || 0;
    if (efficiencyEl) efficiencyEl.textContent = ((data.shares?.rate || 0).toFixed(1)) + '%';
    
    // Update performance metrics
    const validEl = document.getElementById('perf-valid');
    const invalidEl = document.getElementById('perf-invalid');
    const connectionsEl = document.getElementById('perf-connections');
    const jobsEl = document.getElementById('perf-jobs');
    
    if (validEl) validEl.textContent = data.shares?.valid || 0;
    if (invalidEl) invalidEl.textContent = data.shares?.invalid || 0;
    if (connectionsEl) connectionsEl.textContent = data.stratum?.totalConnections || 0;
    if (jobsEl) jobsEl.textContent = data.stratum?.jobs || 0;
}

// Format hashrate
function formatHashrate(hashrate) {
    if (hashrate >= 1e12) return (hashrate / 1e12).toFixed(2) + ' TH/s';
    if (hashrate >= 1e9) return (hashrate / 1e9).toFixed(2) + ' GH/s';
    if (hashrate >= 1e6) return (hashrate / 1e6).toFixed(2) + ' MH/s';
    if (hashrate >= 1e3) return (hashrate / 1e3).toFixed(2) + ' KH/s';
    return hashrate.toFixed(2) + ' H/s';
}


// Simple hashrate card update function
function updateHashrateCards(data) {
    const currentHashrate = data.total_hashrate || 0;
    const avgHashrate = data.avg_3h_hashrate || data.total_hashrate || 0;
    
    // Update current hashrate
    const currentElement = document.getElementById('lookup-current-hashrate');
    if (currentElement) {
        currentElement.textContent = formatHashrate(currentHashrate);
    }
    
    // Update average hashrate
    const avgElement = document.getElementById('lookup-avg-hashrate');
    if (avgElement) {
        avgElement.textContent = formatHashrate(avgHashrate);
    }
}


// Refresh data function for statistics page
function refreshData() {
    if (window.dashboard) {
        window.dashboard.fetchStatsData();
    }
}

// Mobile menu toggle function
function toggleMobileMenu() {
    const mobileToggle = document.querySelector('.mobile-menu-toggle');
    const tabs = document.querySelector('.tabs');
    
    if (mobileToggle && tabs) {
        mobileToggle.classList.toggle('active');
        tabs.classList.toggle('mobile-menu-open');
        
        // Add click outside to close functionality
        if (tabs.classList.contains('mobile-menu-open')) {
            document.addEventListener('click', closeMobileMenuOutside);
        } else {
            document.removeEventListener('click', closeMobileMenuOutside);
        }
    }
}

// Close mobile menu when clicking outside
function closeMobileMenuOutside(event) {
    const mobileToggle = document.querySelector('.mobile-menu-toggle');
    const tabs = document.querySelector('.tabs');
    
    if (mobileToggle && tabs && 
        !mobileToggle.contains(event.target) && 
        !tabs.contains(event.target)) {
        mobileToggle.classList.remove('active');
        tabs.classList.remove('mobile-menu-open');
        document.removeEventListener('click', closeMobileMenuOutside);
    }
}

// Helper function to update workers table without rebuilding structure
function updateWorkersTable(workers, isOnline) {
    const workersTable = document.getElementById('lookup-workers-table');
    
    if (!workers || workers.length === 0) {
        workersTable.innerHTML = '<div class="no-data-message">No workers found. Start mining to see worker data here.</div>';
        return;
    }
    
    // Check if table exists, if not create it
    let table = workersTable.querySelector('table');
    if (!table) {
        workersTable.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Worker Name</th>
                        <th>Hashrate</th>
                        <th>Shares</th>
                        <th>Status</th>
                        <th>Last Seen</th>
                    </tr>
                </thead>
                <tbody>
                </tbody>
            </table>
        `;
        table = workersTable.querySelector('table');
    }
    
    const tbody = table.querySelector('tbody');
    
    // Update existing rows or add new ones
    workers.forEach((worker, index) => {
        const isWorkerOnline = (worker.last_seen && (Date.now() - worker.last_seen < 120000)) ||
                               (worker.hashrate && worker.hashrate > 0) ||
                               isOnline;
        
        let row = tbody.children[index];
        if (!row) {
            row = tbody.insertRow();
            row.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
        }
        
        // Update row values
        row.cells[0].textContent = worker.worker_name || 'Unknown';
        row.cells[1].textContent = formatHashrate(worker.hashrate || 0);
        row.cells[2].textContent = (worker.shares || 0).toLocaleString();
        row.cells[3].innerHTML = `<span class="status-indicator ${isWorkerOnline ? 'status-online' : 'status-offline'}"></span>${isWorkerOnline ? 'Online' : 'Offline'}`;
        row.cells[4].textContent = formatTimeAgo(worker.last_seen);
    });
    
    // Remove extra rows if workers array is smaller
    while (tbody.children.length > workers.length) {
        tbody.removeChild(tbody.lastChild);
    }
}

// Helper function to update shares table without rebuilding structure
function updateSharesTable(shares) {
    const sharesTable = document.getElementById('lookup-shares-table');
    
    if (!shares || shares.length === 0) {
        sharesTable.innerHTML = '<div class="no-data-message">No recent shares found. Start mining to see share data here.</div>';
        return;
    }
    
    const recentShares = shares.slice(0, 20);
    
    // Check if table exists, if not create it
    let table = sharesTable.querySelector('table');
    if (!table) {
        sharesTable.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Worker</th>
                        <th>Difficulty</th>
                        <th>Block Height</th>
                        <th>Status</th>
                        <th>Block Found</th>
                    </tr>
                </thead>
                <tbody>
                </tbody>
            </table>
        `;
        table = sharesTable.querySelector('table');
    }
    
    const tbody = table.querySelector('tbody');
    
    // Update existing rows or add new ones
    recentShares.forEach((share, index) => {
        let row = tbody.children[index];
        if (!row) {
            row = tbody.insertRow();
            row.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td>';
        }
        
        // Update row values
        row.cells[0].textContent = formatTimeAgo(share.timestamp);
        row.cells[1].textContent = share.worker_name || 'Unknown';
        row.cells[2].textContent = (share.difficulty || 0).toLocaleString();
        row.cells[3].textContent = share.block_height || '-';
        row.cells[4].innerHTML = `<span class="status-${share.valid ? 'valid' : 'invalid'}">${share.valid ? 'Valid' : 'Invalid'}</span>`;
        row.cells[5].innerHTML = share.is_block ? '<span class="block-indicator">✓</span>' : '-';
    });
    
    // Remove extra rows if shares array is smaller
    while (tbody.children.length > recentShares.length) {
        tbody.removeChild(tbody.lastChild);
    }
}

// Close mobile menu when a tab is selected
document.addEventListener('DOMContentLoaded', function() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            // Close mobile menu when tab is selected
            const mobileToggle = document.querySelector('.mobile-menu-toggle');
            const tabsContainer = document.querySelector('.tabs');
            
            if (mobileToggle && tabsContainer && 
                tabsContainer.classList.contains('mobile-menu-open')) {
                mobileToggle.classList.remove('active');
                tabsContainer.classList.remove('mobile-menu-open');
                document.removeEventListener('click', closeMobileMenuOutside);
            }
        });
    });
});

// Initialize dashboard when script loads
window.dashboard = new MiningPoolDashboard();