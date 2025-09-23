# Pastella Mining Pool

A professional mining pool for the Pastella cryptocurrency, built with Node.js and supporting the
Velora algorithm. This mining pool provides a complete solution for miners to contribute their
hashing power and earn rewards.

## 🌟 Features

- **Real-time Block Templates**: Integrates with Pastella daemon for live block templates
- **Velora Algorithm Support**: Full support for the Velora proof-of-work algorithm
- **Stratum Protocol**: Industry-standard mining protocol support
- **Web Dashboard**: Beautiful dark mode interface with real-time statistics
- **Share Validation**: Real-time share validation using the Velora algorithm
- **Multi-GPU Support**: Efficient handling of multiple mining devices
- **Database Storage**: SQLite database for persistent data storage
- **API Endpoints**: RESTful API for integration and monitoring
- **Real-time Updates**: Live updates via WebSocket connections

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Pastella      │    │   Mining Pool    │    │   Miners        │
│   Daemon        │◄──►│   (Node.js)      │◄──►│   (Stratum)     │
│   (API Server)  │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │   Web Dashboard  │
                       │   (React/HTML)   │
                       └──────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 16.0.0 or higher
- npm 8.0.0 or higher
- Pastella daemon running (for block templates)

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/pastella/pastella-mining-pool.git
   cd pastella-mining-pool
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Setup directories**

   ```bash
   npm run setup
   ```

4. **Configure the pool**

   ```bash
   # Edit config/pool.json with your settings
   nano config/pool.json
   ```

5. **Start the mining pool**
   ```bash
   npm start
   ```

## ⚙️ Configuration

### Pool Configuration (`config/pool.json`)

```json
{
  "pool": {
    "name": "Pastella Mining Pool",
    "fee": 0.01,
    "minPayout": 0.001,
    "payoutInterval": 3600000
  },
  "daemon": {
    "url": "http://localhost:3002",
    "apiKey": "your-api-key-here"
  },
  "stratum": {
    "port": 3333,
    "host": "0.0.0.0"
  },
  "http": {
    "port": 3000,
    "host": "0.0.0.0"
  }
}
```

### Key Configuration Options

- **`daemon.url`**: URL of your Pastella daemon (default: `http://localhost:3002`)
- **`daemon.apiKey`**: API key for daemon authentication
- **`stratum.port`**: Port for Stratum mining protocol (default: 3333)
- **`http.port`**: Port for web dashboard (default: 3000)
- **`pool.fee`**: Pool fee percentage (default: 1%)
- **`mining.difficulty`**: Pool difficulty (default: 1000)

## 🔧 Miner Configuration

### Stratum Configuration

Configure your miner to connect to the pool:

```
stratum+tcp://your-pool-ip:3333
```

### Example Miner Commands

#### Pastella Miner

```bash
./pastella-miner --pool stratum+tcp://localhost:3333 --wallet your-wallet-address
```

#### XMRig (with custom algorithm)

```bash
./xmrig -o stratum+tcp://localhost:3333 -u your-wallet-address -p x -a velora
```

## 📊 Web Dashboard

Access the web dashboard at `http://localhost:3000` to view:

- **Pool Overview**: Real-time pool statistics
- **Connected Miners**: Active mining connections
- **Found Blocks**: Blocks found by the pool
- **Payment History**: Miner payout information
- **Mining Instructions**: Setup guides for miners
- **Statistics**: Detailed performance metrics

## 🔌 API Endpoints

### Public Endpoints

- `GET /health` - Health check
- `GET /api/status` - Pool status
- `GET /api/miners` - Connected miners
- `GET /api/shares` - Share statistics
- `GET /api/block-template` - Current block template
- `GET /api/pool-stats` - Pool statistics

### Administrative Endpoints

- `POST /api/template/update` - Force template update
- `POST /api/stats/reset` - Reset statistics
- `GET /api/daemon/status` - Daemon connection status

## 🗄️ Database Schema

The pool uses SQLite to store:

- **Miners**: Miner information and statistics
- **Shares**: Valid and invalid share records
- **Blocks**: Found blocks and their details
- **Payments**: Payment history and pending payouts
- **Pool Stats**: Historical pool performance data

## 🔒 Security Features

- **Rate Limiting**: Protection against DoS attacks
- **Input Validation**: Secure parameter handling
- **Authentication**: API key support for sensitive operations
- **CORS Protection**: Configurable cross-origin restrictions

## 📈 Monitoring and Logging

### Log Files

- `logs/pool.log` - Main application logs
- `logs/error.log` - Error-specific logs

### Log Levels

- `error` - Error conditions
- `warn` - Warning conditions
- `info` - General information
- `debug` - Detailed debugging information

## 🚨 Troubleshooting

### Common Issues

1. **Daemon Connection Failed**
   - Ensure Pastella daemon is running
   - Check daemon URL and API key in config
   - Verify daemon is accessible from pool server

2. **No Block Templates**
   - Check daemon API endpoint `/api/mining/template`
   - Verify daemon has transactions in mempool
   - Check daemon logs for errors

3. **Miners Can't Connect**
   - Verify Stratum port (default: 3333) is open
   - Check firewall settings
   - Ensure pool is running and accessible

4. **Shares Not Validating**
   - Check Velora algorithm implementation
   - Verify block template is current
   - Check share validation logs

### Debug Mode

Enable debug logging by setting log level to `debug` in config:

```json
{
  "logging": {
    "level": "debug"
  }
}
```

## 🔄 Development

### Development Mode

```bash
npm run dev
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```

## 📝 API Documentation

### Stratum Protocol

The pool implements the Stratum mining protocol with these methods:

- `mining.subscribe` - Subscribe to mining notifications
- `mining.authorize` - Authorize mining worker
- `mining.submit` - Submit mining share
- `mining.get_transactions` - Get job transactions
- `mining.suggest_difficulty` - Suggest difficulty adjustment

### Share Validation

Shares are validated using the Velora algorithm:

1. **Hash Calculation**: Compute hash using submitted parameters
2. **Difficulty Check**: Verify hash meets pool difficulty
3. **Block Check**: Check if hash meets block difficulty
4. **Template Validation**: Ensure share uses current template

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Pastella development team for the Velora algorithm
- Stratum protocol specification
- Node.js community for excellent tooling

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/pastella/pastella-mining-pool/issues)
- **Discussions**:
  [GitHub Discussions](https://github.com/pastella/pastella-mining-pool/discussions)
- **Documentation**: [Wiki](https://github.com/pastella/pastella-mining-pool/wiki)

---

**Happy Mining! ⛏️✨**
