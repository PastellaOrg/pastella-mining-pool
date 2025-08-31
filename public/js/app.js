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
        if (data.mining && data.mining.template && data.mining.template.index) {
            document.getElementById('current-block').textContent = data.mining.template.index;
        }

        // Update pool uptime
        if (data.uptime !== undefined) {
            document.getElementById('pool-uptime').textContent = this.formatUptime(data.uptime);
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
                const response = await fetch('/api/miners');
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
                            hashrate: realtimeMiner ? realtimeMiner.hashrate : dbMiner.hashrate || 0
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
            <table class="miners-table">
                <thead>
                    <tr>
                        <th>Worker</th>
                        <th>Address</th>
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
                    ${miners.map(miner => `
                        <tr data-address="${miner.address || 'unknown'}">
                            <td><strong>${miner.worker_name || miner.worker || 'Unknown'}</strong></td>
                            <td style="font-family: monospace; font-size: 0.9rem;">${miner.address || 'Unknown'}</td>
                            <td class="hashrate">${this.formatHashrate(miner.hashrate || 0)}</td>
                            <td>${miner.share_stats ? miner.share_stats.total : (miner.shares || 0)}</td>
                            <td style="color: #4CAF50;">${miner.share_stats ? miner.share_stats.valid : 0}</td>
                            <td style="color: #f44336;">${miner.share_stats ? miner.share_stats.rejected : 0}</td>
                            <td style="color: #2196F3;">${miner.share_stats ? miner.share_stats.blocks_found : 0}</td>
                            <td>${this.formatTimestamp(miner.last_seen)}</td>
                            <td>
                                <span class="status-indicator status-online"></span>
                                Online
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
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
            // Fetch both database miners and real-time hashrate data
            const [minersResponse, hashrateResponse] = await Promise.all([
                fetch('/api/miners'),
                fetch('/api/miners/hashrate')
            ]);

            const minersData = await minersResponse.json();
            const hashrateData = await hashrateResponse.json();

            if (minersData.miners) {
                // Merge database data with real-time hashrate data
                const minersWithHashrate = minersData.miners.map(dbMiner => {
                    const realtimeMiner = hashrateData.miners.find(rt => rt.address === dbMiner.address);
                    return {
                        ...dbMiner,
                        hashrate: realtimeMiner ? realtimeMiner.hashrate : dbMiner.hashrate || 0
                    };
                });

                this.updateMinersTable(minersWithHashrate);
            } else {
                document.getElementById('miners-table-container').innerHTML =
                    '<div class="error">Failed to load miners data</div>';
            }
        } catch (error) {
            console.error('Failed to fetch miners data:', error);
            document.getElementById('miners-table-container').innerHTML =
                '<div class="error">Failed to load miners data</div>';
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
                    <table>
                        <thead>
                            <tr>
                                <th>Height</th>
                                <th>Hash</th>
                                <th>Found By</th>
                                <th>Difficulty</th>
                                <th>Timestamp</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.blocks.map(block => `
                                <tr>
                                    <td>${block.height}</td>
                                    <td style="font-family: monospace; font-size: 0.9rem;">${block.hash.substring(0, 16)}...</td>
                                    <td style="font-family: monospace; font-size: 0.9rem;">${block.found_by}</td>
                                    <td>${block.difficulty}</td>
                                    <td>${this.formatTimestamp(block.timestamp)}</td>
                                    <td>
                                        <span class="status-indicator ${block.status === 'confirmed' ? 'status-online' : 'status-offline'}"></span>
                                        ${block.status}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
                container.innerHTML = blocksHtml;
            } else {
                container.innerHTML = '<p style="text-align: center; color: #666;">No blocks found yet</p>';
            }
        } catch (error) {
            console.error('Failed to fetch blocks data:', error);
            const container = document.getElementById('blocks-table-container');
            if (container) {
                container.innerHTML = '<div class="error">Failed to load blocks data</div>';
            }
        }
    }

    async fetchPaymentsData() {
        try {
            const response = await fetch('/api/payments');
            const data = await response.json();

            const container = document.getElementById('payments-table-container');
            if (!container) return;

            if (data.payments && data.payments.length > 0) {
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
                            ${data.payments.map(payment => `
                                <tr>
                                    <td style="font-family: monospace; font-size: 0.9rem;">${payment.address.substring(0, 16)}...</td>
                                    <td>${payment.amount} PSTL</td>
                                    <td style="font-family: monospace; font-size: 0.9rem;">${payment.txId.substring(0, 16)}...</td>
                                    <td>${this.formatTimestamp(payment.timestamp)}</td>
                                    <td>
                                        <span class="status-indicator ${payment.status === 'confirmed' ? 'status-online' : 'status-offline'}"></span>
                                        ${payment.status}
                                    </td>
                                </tr>
                            `).join('')}
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
                const statsHtml = `
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-value">${data.pool?.name || 'Unknown'}</div>
                            <div class="stat-label">Pool Name</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${data.pool?.version || 'Unknown'}</div>
                            <div class="stat-label">Version</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${data.pool?.algorithm || 'Unknown'}</div>
                            <div class="stat-label">Algorithm</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${(data.pool?.fee || 0) * 100}%</div>
                            <div class="stat-label">Pool Fee</div>
                        </div>
                    </div>

                    <div class="block-info">
                        <h4>Mining Information</h4>
                        <div class="block-details">
                            <div class="block-detail">
                                <div class="label">Current Difficulty</div>
                                <div class="value">${data.mining?.difficulty || 0}</div>
                            </div>
                            <div class="block-detail">
                                <div class="label">Block Difficulty</div>
                                <div class="value">${data.mining?.blockDifficulty || 0}</div>
                            </div>
                            <div class="block-detail">
                                <div class="label">Share Timeout</div>
                                <div class="value">${this.formatUptime((data.mining?.shareTimeout || 0) / 1000)}</div>
                            </div>
                        </div>
                    </div>

                    <div class="payment-info">
                        <h4>Pool Statistics</h4>
                        <div class="payment-details">
                            <div class="payment-detail">
                                <div class="label">Total Shares</div>
                                <div class="value">${data.shares?.total || 0}</div>
                            </div>
                            <div class="payment-detail">
                                <div class="label">Valid Shares</div>
                                <div class="value">${data.shares?.valid || 0}</div>
                            </div>
                            <div class="payment-detail">
                                <div class="label">Invalid Shares</div>
                                <div class="value">${data.shares?.invalid || 0}</div>
                            </div>
                            <div class="payment-detail">
                                <div class="label">Blocks Found</div>
                                <div class="value">${data.blocks?.found || 0}</div>
                            </div>
                        </div>
                    </div>
                `;
                container.innerHTML = statsHtml;
            } else {
                container.innerHTML = '<div class="error">Failed to load statistics</div>';
            }
        } catch (error) {
            console.error('Failed to fetch statistics data:', error);
            const container = document.getElementById('stats-container');
            if (container) {
                container.innerHTML = '<div class="error">Failed to load statistics</div>';
            }
        }
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
                            ${activity.type === 'block_found' ? '🎯' : '⚡'}
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

// Initialize dashboard when script loads
window.dashboard = new MiningPoolDashboard();