export interface PoolConfig {
  name: string;
  coin: string;
  ticker: string; // Frontend uses this
  symbol?: string; // API sends this
  algorithm: string;
  decimals?: number; // Optional for backward compatibility
  coinDecimalPlaces?: number; // Field name from API
  poolFee: number;
  minPayout: number;
  payoutInterval: number;
  ports: {
    [key: string]: {
      port: number;
      difficulty: number;
      desc: string;
    };
  };
  blockTime: number;
}

export interface ApiConfig {
  poolHost: string;
  ports: Array<{
    port: number;
    difficulty: number;
    desc: string;
  }>;
  cnAlgorithm: string;
  cnVariant: number;
  cnBlobType: number;
  hashrateWindow: number;
  fee: number;
  soloFee: number;
  networkFee: number;
  coin: string;
  coinUnits: number;
  coinDecimalPlaces: number;
  coinDifficultyTarget: number;
  symbol: string;
  depth: number;
  finderReward: number;
  donation: Record<string, unknown>;
  version: string;
  paymentsInterval: number;
  minPaymentThreshold: number;
  maxPaymentThreshold: number | null;
  transferFee: number;
  denominationUnit: number;
  slushMiningEnabled: boolean;
  weight: number;
  priceSource: string;
  priceCurrency: string;
  paymentIdSeparator: string;
  fixedDiffEnabled: boolean;
  fixedDiffSeparator: string;
  sendEmails: boolean;
  blocksChartEnabled: boolean;
  blocksChartDays: number;
  telegramBotName: string | null;
  telegramBotStats: string;
}

export interface PoolStats {
  config?: PoolConfig;
  hashRate: number;
  miners: number;
  workers: number;
  totalHashes: number;
  totalShares: number;
  blocks: {
    candidates: number;
    confirmed: number;
    orphaned: number;
  };
  lastBlockFound?: number;
  network?: {
    hashRate: number;
    difficulty: number;
    height: number;
  };
}

export interface ApiResponse {
  config: ApiConfig;
  health: Record<string, {
    daemon: string;
    wallet: string;
    price: string | null;
  }>;
  network: {
    difficulty: number;
    height: number;
  };
  pool: {
    stats: {
      lastBlockFoundprop: string;
    };
    blocks: string[];
    totalBlocks: number;
    totalBlocksSolo: number;
    totalDiff: number;
    totalDiffSolo: number;
    totalShares: number;
    totalSharesSolo: number;
    payments: string[];
    totalPayments: number;
    totalMinersPaid: number;
    miners: number;
    minersSolo: number;
    workers: number;
    workersSolo: number;
    hashrate: number;
    hashrateSolo: number;
    roundScore: number;
    roundHashes: number;
    lastBlockFound: string;
  };
  lastblock: {
    difficulty: number;
    height: number;
    timestamp: number;
    reward: number;
    hash: string;
  };
  charts: {
    hashrate: Array<[number, number, number]>;
    miners: Array<[number, number, number]>;
    workers: Array<[number, number, number]>;
    difficulty: Array<[number, number, number]>;
    hashrateSolo: Array<[number, number, number]>;
    minersSolo: Array<[number, number, number]>;
    workersSolo: Array<[number, number, number]>;
    blocks: Record<string, number>;
    blocksSolo: Record<string, number>;
  };
  miner: Record<string, unknown>;
}

export interface MinerStats {
  hashRate: number;
  hashRate1h?: number;
  hashRate6h?: number;
  hashRate24h?: number;
  lastShare: number;
  hashes: number;
  shares: number;
  balance: number;
  paid: number;
  roundHashes?: number;
  roundScore?: number;
  roundSharePercent?: number;
  workers?: WorkerStats[];
  charts?: Record<string, unknown>;
}

export interface WorkerStats {
  name: string;
  hashRate: number;
  hashRate1h?: number;
  hashRate6h?: number;
  hashRate24h?: number;
  lastShare: number;
  hashes: number;
  type?: 'solo' | 'prop'; // Worker mining type (solo or prop/PPLNS)
}

export interface Block {
  height: number;
  hash: string;
  timestamp: number;
  difficulty: number;
  status?: 'pending' | 'confirmed' | 'orphaned';
  reward?: number;
  miner?: string;
  type?: string; // 'prop' or 'solo'
  shares?: number;
  effort?: number;
}

// Extended block type for miner stats with additional fields
export interface MinerBlock extends Block {
  minerReward?: number;
  sharePercent?: number;
}

// Structured block object from backend API
export interface ApiBlock {
  height: number;
  type: string; // 'prop' or 'solo'
  miner: string;
  hash: string;
  timestamp: number;
  difficulty: number;
  shares: number;
  status: 'pending' | 'confirmed' | 'orphaned';
  reward: number;
  effort: number; // Calculated as shares / difficulty * 100
  score?: number; // Total score for PPLNS
  minerScore?: number; // Individual miner's score for PPLNS
}

export interface Payment {
  amount: number;
  fee: number;
  timestamp: number;
  txHash?: string;
  address?: string;
}

export interface Miner {
  address: string;
  hashRate: number;
  hashes?: number;
  lastShare?: string;
  isActive?: boolean;
}

// Admin types
export interface AdminStats {
  totalOwed: number;
  totalPaid: number;
  totalRevenue: number;
  totalRevenueSolo: number;
  totalShares: number;
  blocksUnlocked: number;
  blocksOrphaned: number;
  totalWorkers: number;
}

export interface AdminUser {
  pending: string;
  paid: string;
  lastShare: string;
  hashes: string;
  childWallet: string | null;
  hashrate: number;
  roundScore: number;
  roundHashes: number;
}

export interface AdminUsers {
  [address: string]: AdminUser;
}

export interface MonitoringService {
  lastCheck: string;
  lastStatus: string;
  lastResponse: string;
}

export interface MonitoringData {
  daemon: MonitoringService;
  wallet: MonitoringService;
}

export interface LogFileInfo {
  size: number;
  changed: number;
}

export interface LogsData {
  [filename: string]: LogFileInfo;
}

export interface AdminMonitoring {
  monitoring: MonitoringData;
  logs: LogsData;
}

export interface AdminPorts {
  ports: { [port: string]: number };
}
