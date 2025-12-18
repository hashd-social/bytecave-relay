/**
 * ByteCave Relay Node Configuration
 */

export interface RelayConfig {
  listenAddresses: string[];
  announceAddresses: string[];
  privateKeyPath?: string;
  maxConnections: number;
  enableMetrics: boolean;
  metricsPort: number;
  bootstrapPeers: string[];
  enableDHT?: boolean; // Optional, defaults to true
}

export function loadConfig(): RelayConfig {
  const listenAddrs = process.env.RELAY_LISTEN_ADDRESSES || '/ip4/0.0.0.0/tcp/4001,/ip4/0.0.0.0/tcp/4002/ws';
  const announceAddrs = process.env.RELAY_ANNOUNCE_ADDRESSES || '';
  const bootstrapPeers = process.env.RELAY_BOOTSTRAP_PEERS || '';

  return {
    listenAddresses: listenAddrs.split(',').filter(a => a.trim()),
    announceAddresses: announceAddrs ? announceAddrs.split(',').filter(a => a.trim()) : [],
    privateKeyPath: process.env.RELAY_PRIVATE_KEY_PATH,
    maxConnections: parseInt(process.env.RELAY_MAX_CONNECTIONS || '1000', 10),
    enableMetrics: process.env.RELAY_ENABLE_METRICS === 'true',
    metricsPort: parseInt(process.env.RELAY_METRICS_PORT || '9090', 10),
    bootstrapPeers: bootstrapPeers ? bootstrapPeers.split(',').filter(a => a.trim()) : []
  };
}
