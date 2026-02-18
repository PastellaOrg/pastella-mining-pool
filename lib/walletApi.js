/**
 * Pastella Wallet API Client
 * Handles communication with Pastella Wallet API for pool payments
 **/

const fs = require('fs');
const http = require('http');
const https = require('https');
const URL = require('url');

// Initialize log system (config must be loaded first by requiring module)
let logSystem = 'walletApi';
require('./exceptionWriter.js')(logSystem);

// Wallet API configuration
let walletConfig = {
    host: config.walletApi?.host || '127.0.0.1',
    port: config.walletApi?.port || 21002,
    apiKey: config.walletApi?.apiKey || 'your_rpc_password',
    timeout: config.walletApi?.timeout || 30000,
    walletFile: config.walletApi?.walletFile || '/root/pastella-wallet/pool.wallet',
    walletPassword: config.walletApi?.walletPassword || 'pool_password'
};

// Track if wallet is loaded
let walletLoaded = false;
let walletAddress = null;

/**
 * Make HTTP request to Wallet API
 **/
function apiRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const url = `http://${walletConfig.host}:${walletConfig.port}${path}`;
        const urlObj = URL.parse(url);

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': walletConfig.apiKey
            },
            timeout: walletConfig.timeout
        };

        if (data) {
            const jsonData = JSON.stringify(data);
            options.headers['Content-Length'] = Buffer.byteLength(jsonData);
        }

        const protocol = urlObj.protocol === 'https:' ? https : http;

        const req = protocol.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                // Handle empty response for wallet/create
                if ((res.statusCode === 200 || res.statusCode === 201) && responseData.trim() === '') {
                    resolve({});
                    return;
                }

                // Accept all 2xx status codes as success
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
                    return;
                }

                try {
                    const json = JSON.parse(responseData);
                    resolve(json);
                } catch (e) {
                    reject(new Error(`Failed to parse response: ${e.message}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (data) {
            req.write(JSON.stringify(data));
        }

        req.end();
    });
}

/**
 * Initialize wallet - load or create
 **/
function initializeWallet() {
    return new Promise((resolve, reject) => {
        // Check if wallet file exists
        fs.access(walletConfig.walletFile, fs.constants.F_OK, (err) => {
            if (err) {
                // Wallet file doesn't exist, create new wallet
                log('warn', logSystem, 'Wallet does not exist');
                createWallet().then(resolve).catch(reject);
            } else {
                // Wallet file exists, open it
                openWallet().then(resolve).catch(reject);
            }
        });
    });
}

/**
 * Create new wallet
 **/
function createWallet() {
    return new Promise((resolve, reject) => {
        const createData = {
            filename: walletConfig.walletFile,
            password: walletConfig.walletPassword
        };

        apiRequest('POST', '/wallet/create', createData)
            .then((result) => {
                walletLoaded = true;

                // Check if response has address
                if (result && result.address) {
                    walletAddress = result.address;
                    log('info', logSystem, 'Wallet has been created');
                    log('info', logSystem, 'Wallet address is: %s', [result.address]);
                    if (result.mnemonicSeed) {
                        log('info', logSystem, 'Mnemonic Seed: %s', [result.mnemonicSeed]);
                    }
                    resolve(result);
                } else {
                    // Response is empty, try to get address from wallet
                    getPrimaryAddress()
                        .then((address) => {
                            walletAddress = address;
                            log('info', logSystem, 'Wallet has been created');
                            log('info', logSystem, 'Wallet address is: %s', [address]);
                            resolve({ address: address });
                        })
                        .catch((err) => {
                            reject(new Error('Wallet created but failed to get address: ' + err.message));
                        });
                }
            })
            .catch((error) => {
                log('error', logSystem, 'Failed to create wallet: %s', [error.message]);
                reject(error);
            });
    });
}

/**
 * Open existing wallet
 **/
function openWallet() {
    return new Promise((resolve, reject) => {
        const openData = {
            filename: walletConfig.walletFile,
            password: walletConfig.walletPassword
        };

        // Use daemon settings from config
        if (config.daemon) {
            openData.daemonHost = config.daemon.host || '127.0.0.1';
            openData.daemonPort = config.daemon.port || 21001;
        }

        apiRequest('POST', '/wallet/open', openData)
            .then((result) => {
                walletLoaded = true;

                // Get and display the address
                getPrimaryAddress()
                    .then((address) => {
                        walletAddress = address;
                        log('info', logSystem, 'Wallet has been loaded');
                        log('info', logSystem, 'Wallet address is: %s', [address]);
                        resolve(result);
                    })
                    .catch((err) => {
                        log('error', logSystem, 'Could not get wallet address: %s', [err.message]);
                        reject(err);
                    });
            })
            .catch((error) => {
                // Check if wallet is already loaded (HTTP 403)
                if (error.message && error.message.includes('HTTP 403')) {
                    log('info', logSystem, 'Wallet is already loaded in API');
                    walletLoaded = true;

                    // Just get the address
                    getPrimaryAddress()
                        .then((address) => {
                            walletAddress = address;
                            log('info', logSystem, 'Wallet has been loaded');
                            log('info', logSystem, 'Wallet address is: %s', [address]);
                            resolve({});
                        })
                        .catch((err) => {
                            log('error', logSystem, 'Could not get wallet address: %s', [err.message]);
                            reject(err);
                        });
                } else {
                    log('error', logSystem, 'Failed to open wallet: %s', [error.message]);
                    reject(error);
                }
            });
    });
}

/**
 * Get primary wallet address
 **/
function getPrimaryAddress() {
    return apiRequest('GET', '/addresses/primary')
        .then((result) => {
            if (result && result.address) {
                return result.address;
            }
            throw new Error('No address in response');
        });
}

/**
 * Get wallet balance
 **/
function getBalance() {
    return apiRequest('GET', '/balance')
        .then((result) => {
            return {
                unlocked: result.unlocked || 0,
                locked: result.locked || 0
            };
        });
}

/**
 * Send basic transaction to single destination
 **/
function sendBasicTransaction(destination, amount) {
    const txData = {
        destination: destination,
        amount: amount
    };

    return apiRequest('POST', '/transactions/send/basic', txData)
        .then((result) => {
            return {
                transactionHash: result.transactionHash,
                fee: result.fee || 0
            };
        });
}

/**
 * Send advanced transaction to multiple destinations
 **/
function sendAdvancedTransaction(destinations) {
    const txData = {
        destinations: destinations.map(dest => ({
            address: dest.address,
            amount: dest.amount
        }))
    };

    return apiRequest('POST', '/transactions/send/advanced', txData)
        .then((result) => {
            return {
                transactionHash: result.transactionHash,
                fee: result.fee || 0
            };
        });
}

/**
 * Check if wallet is loaded
 **/
function isWalletLoaded() {
    return walletLoaded;
}

/**
 * Get wallet address
 **/
function getWalletAddress() {
    return walletAddress;
}

// Export functions
exports.initializeWallet = initializeWallet;
exports.createWallet = createWallet;
exports.openWallet = openWallet;
exports.getPrimaryAddress = getPrimaryAddress;
exports.getBalance = getBalance;
exports.sendBasicTransaction = sendBasicTransaction;
exports.sendAdvancedTransaction = sendAdvancedTransaction;
exports.isWalletLoaded = isWalletLoaded;
exports.getWalletAddress = getWalletAddress;

// Auto-initialize on module load
if (require.main === module) {
    // Running as standalone script
    initializeWallet()
        .then(() => {
            log('info', logSystem, 'Wallet initialization complete');
            process.exit(0);
        })
        .catch((error) => {
            log('error', logSystem, 'Wallet initialization failed: %s', [error.message]);
            process.exit(1);
        });
}
