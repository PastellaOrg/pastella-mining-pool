export interface MiningSoftware {
  name: string;
  architectures: string[];
  downloadLink: string;
  commandTemplate: string;
  algorithms: Record<string, string>;
}

export default {
  // Pool API endpoint
  api: 'https://pool.pastella.org/api',
  block_url: 'https://explorer.pastella.org/block/',
  tx_url: 'https://explorer.pastella.org/transaction/',
  wallet_url: 'https://explorer.pastella.org/wallet/',

  // Mining software configuration
  miningSoftware: [
    {
      name: 'XMRig',
      architectures: ['CPU', 'NVIDIA', 'AMD'],
      downloadLink: 'https://github.com/xmrig/xmrig/releases',
      commandTemplate: 'xmrig{windows} -a {algorithm} -o {hostname}:{port} -u {username} -p {password}',
      algorithms: {
        'randomx': 'rx/0',
      }
    },
    {
      name: 'SRBMiner',
      architectures: ['CPU'],
      downloadLink: 'https://github.com/doktor83/SRBMiner-Multi/releases',
      commandTemplate: 'SRBMiner-MULTI{windows} -a {algorithm} -o {hostname}:{port} -u {username} -p {password}',
      algorithms: {
        'randomx': 'randomx',
      }
    }
  ]
};
