import config from '../config/pool';
import type { PoolStats, MinerStats, WorkerStats, Payment, Miner, ApiBlock } from '../types';

class ApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.api;
  }

  private async fetchJson<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getPoolStats(): Promise<PoolStats> {
    return this.fetchJson<PoolStats>('/stats');
  }

  async getLiveStats(address?: string): Promise<MinerStats | PoolStats> {
    const url = address ? `/live_stats?address=${address}` : '/live_stats';
    return this.fetchJson<MinerStats | PoolStats>(url);
  }

  async getMinerStats(address: string, longpoll = false): Promise<MinerStats & { payments?: Payment[], charts?: Record<string, unknown>, workers?: WorkerStats[] }> {
    const url = `/stats_address?address=${address}&longpoll=${longpoll}`;
    return this.fetchJson(url);
  }

  async getBlocks(height?: number, page?: number, limit?: number): Promise<{
    blocks: ApiBlock[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } | { error: string }> {
    const params = new URLSearchParams();
    if (height) params.append('height', height.toString());
    if (page) params.append('page', page.toString());
    if (limit) params.append('limit', limit.toString());
    const url = `/get_blocks${params.toString() ? '?' + params.toString() : ''}`;
    return this.fetchJson(url);
  }

  async getPayments(page?: number, limit?: number): Promise<{
    payments: Payment[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const params = new URLSearchParams();
    if (page) params.append('page', page.toString());
    if (limit) params.append('limit', limit.toString());
    const url = `/get_payments${params.toString() ? '?' + params.toString() : ''}`;
    return this.fetchJson(url);
  }

  async getMarket(): Promise<Record<string, unknown>> {
    return this.fetchJson('/get_market');
  }

  async getTopMiners(): Promise<{ miners: Miner[] }> {
    return this.fetchJson<{ miners: Miner[] }>('/get_top10miners');
  }

  async getBlockExplorers(): Promise<{ explorers: Array<{ url: string, name: string }> }> {
    return this.fetchJson('/block_explorers');
  }

  async getApis(): Promise<Record<string, unknown>> {
    return this.fetchJson('/get_apis');
  }
}

const apiService = new ApiService();
export default apiService;
