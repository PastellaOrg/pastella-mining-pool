pastella-mining-pool
======================

High performance Node.js mining pool for Pastella (PAS) using RandomX algorithm. Includes a modern React-based frontend for pool statistics and miner monitoring.


#### Table of Contents
* [Usage](#usage)
  * [Requirements](#requirements)
  * [1. Downloading & Installing](#1-downloading--installing)
  * [2. Create wallet](#2-create-wallet)
  * [3. Configuration](#3-configuration)
  * [4. Starting the Pool](#4-start-the-pool)
  * [5. Frontend Setup](#5-frontend-setup)
* [Monitoring Your Pool](#monitoring-your-pool)
* [Features](#features)
* [Credits](#credits)
* [License](#license)

Usage
===

#### Requirements
* Latest [Pastella Daemon (pastellad)](https://github.com/PastellaOrg/Pastella)
* [Node.js](http://nodejs.org/) v14.21.3 (Recommend to install using [NVM](https://github.com/creationix/nvm))
* [Redis](http://redis.io/) key-value store v2.6+
  * Ubuntu:
```
sudo add-apt-repository ppa:chris-lea/redis-server
sudo apt-get update
sudo apt-get install redis-server
```
* Ubuntu Packages:
```sudo apt-get install libssl-dev libboost-all-dev libsodium-dev```

##### Seriously
Those are legitimate requirements. If you use old versions of Node.js or Redis that may come with your system package manager then you will have problems. Follow the linked instructions to get the last stable versions.

#### 1) Downloading & Installing

```bash
git clone https://github.com/PastellaOrg/pastella-mining-pool
cd pastella-mining-pool
npm i
```
_*Please note that if you installed NVM that you also have to install node trough NVM with `nvm install 14.21.3`_

#### 2) Create wallet

1. Go to the location where you extracted or compiled your Pastella Daemon executables.
2. To create the wallet, use this command: `./Pastella-Wallet-API --generate-container --container-file pool.wallet --container-password YourOwnPassword` (You can change YourOwnPassword or pool.wallet with your own information)
3. When you execute, you will see a wallet address output in the terminal. Copy it and enter it in the `config.json` file in [Step 3](#3-configuration)
4. I suggest at this point to make a backup of the `pool.wallet` file to another location on your server and also onto your PC. I HIGHLY recommend this in case of issues in the future.
5. In order to start the Payment Processor (Wallet), use this command `./Pastella-Wallet-API --container-file pool.wallet --container-password YourOwnPassword --rpc-bind-ip 0.0.0.0`

#### 3) Configuration

Edit the `config.json` file and change the following keys:
- **poolHost**: This is your pool hostname - this will be shown on the website where miners connect to
- **poolAddress**: This is the wallet address of the payment processor in order to make payments
- **password**: This is your password for the frontend admin panel where you can see stats
- **daemon -> host**: If you have your daemon running somewhere else, you can change it to a different IP (Make sure to run pastellad with `--rpc-bind-ip 0.0.0.0` for a successful connection)
- **wallet -> host**: If you have your payment processor (Pastella-Wallet-API) running somewhere else, you can change it to a different IP (Make sure to run it with `--rpc-bind-ip 0.0.0.0` for a successful connection)

#### 4) Start the pool

```bash
node init.js
```

The file `config.json` is used by default but a file can be specified using the `-config=file` command argument, for example:

```bash
node init.js -config=config_backup.json
```

This software contains several distinct modules:
* **pool** - Opens ports for miners to connect and processes shares
* **api** - Used by the website to display network, pool and miners' data
* **unlocker** - Processes block candidates and increases miners' balances when blocks are unlocked
* **payments** - Sends out payments to miners according to their balances stored in Redis
* **chartsDataCollector** - Processes miners and workers hashrate stats and charts

By default, running `init.js` will start up all modules. You can optionally start only a specific module by using the `-module=name` command argument, for example:

```bash
node init.js -module=api
```

#### 5) Frontend Setup

The pool includes a modern React-based frontend located in the `frontend/` directory.

**Development:**
```bash
cd frontend
npm install
npm run dev
```

**Production Build:**
```bash
cd frontend
npm run build
```

The built files will be in `frontend/dist/`. Host these files on any web server capable of serving static files (nginx, Apache, etc.).

Edit `frontend/src/config/pool.ts` and update the API URL to point to your pool's API server.

#### Server Configuration for Frontend

The frontend is a Single Page Application (SPA) that uses client-side routing. You must configure your web server to redirect all requests to `index.html` for the routing to work properly.

**Nginx Configuration:**

Add the `try_files` directive to your location block:

```nginx
root /var/www/pastella-mining-pool;

location / {
    try_files $uri $uri/ /index.html;
}
```

After updating, reload nginx: `nginx -s reload`

**Nginx Proxy Manager:**

In your proxy host settings, go to the **Advanced** tab and add this to **Custom Nginx Configuration**:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

**Apache Configuration:**

Create a `.htaccess` file in your web root (where `index.html` is located):

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

**Other Hosting Platforms:**

- **Vercel**: Create `vercel.json` in the frontend directory:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

- **Netlify**: Create `netlify.toml` in the frontend directory:
```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Monitoring Your Pool

* To inspect and make changes to Redis, I suggest using redis-commander (`npm i -g redis-commander`)
* To monitor server load for CPU, Network, IO, etc - I suggest using [Netdata](https://github.com/firehol/netdata)
* To keep your pool node script running in the background, logging to file, and automatically restarting if it crashes - I suggest using [forever](https://github.com/nodejitsu/forever), [PM2](https://github.com/Unitech/pm2) or [tmux](https://github.com/tmux/tmux)


Features
===

#### Optimized pool server
* **TCP (stratum-like) protocol** for server-push based jobs
  * Higher hash rate, lower network/CPU server load, lower orphan block percent
  * Less error-prone compared to old HTTP protocol
* **RandomX algorithm support** - Optimized for CPU mining
* **Share trust algorithm** to reduce share validation hashing CPU load
* **Clustering** for vertical scaling
* **Multiple difficulty ports** - Configure different ports with their own difficulty settings
  * Port 3333: Low end (60K difficulty)
  * Port 5555: Mid range (450K difficulty)
  * Port 7777: High end (1.5M difficulty)
  * Port 9999: Super high end (4.5M difficulty)
* **Miner login validation** - Validates wallet addresses before accepting shares
* **Worker identification** - Specify worker name as the password
* **Variable difficulty** - Automatically adjusts based on miner hashrate
* **Fixed difficulty** - Set fixed difficulty by appending "+[difficulty]" to wallet address
* **Modular components** for horizontal scaling (pool server, database, stats/API, payment processing, frontend)
* **SSL support** for both pool and API servers
* **PPLNS payment system** with 1% block finder bonus

#### Live statistics API
* Currency network/block difficulty
* Current block height
* Network hashrate
* Pool hashrate
* Each miner's individual stats (hashrate, shares submitted, pending balance, total paid, payout estimate, etc.)
* Blocks found (pending, confirmed, and orphaned)
* Historic charts of pool's hashrate, miners count and coin difficulty
* Historic charts of user's hashrate and payments

#### Modern React Frontend
* Responsive design optimized for mobile and desktop
* Real-time statistics updates
* Miner dashboard with worker monitoring
* Blocks and payments history
* Getting started page with mining software downloads
* Top 10 miners leaderboard
* Toast notifications for user feedback
* Dark theme optimized for mining pools

#### Smart payment processing
* Minimum payment threshold before balance will be paid out
* Minimum denomination for truncating payment amount precision
* Configurable payment intervals
* Dynamic transfer fee based on number of payees per transaction
* Option to have miner pay transfer fee instead of pool owner
* Control transaction priority with config.payments.priority

#### Admin panel
* Aggregated pool statistics
* Coin daemon & wallet RPC services stability monitoring
* Log files data access
* Users list with detailed statistics

#### Pool stability monitoring
* Detailed logging in process console & log files
* Coin daemon & wallet RPC services stability monitoring
* See logs data from admin panel


Credits
---------

* [fancoder](https://github.com/fancoder) - Developer of cryptonote-universal-pool project (original fork)
* [dvandal](https://github.com/dvandal) - Developer of cryptonote-nodejs-pool software
* [PastellaPNG](https://github.com/PastellaPNG) - Developer of pastella-mining-pool software

License
-------
Released under the GNU General Public License v2

http://www.gnu.org/licenses/gpl-2.0.html
