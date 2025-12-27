/**
 * ByteCave Relay Node - Entry Point
 * 
 * A standalone relay/bootstrap node for the ByteCave P2P network.
 * 
 * Usage:
 *   RELAY_LISTEN_ADDRESSES=/ip4/0.0.0.0/tcp/4001 yarn start
 * 
 * Environment Variables:
 *   RELAY_LISTEN_ADDRESSES    - Comma-separated multiaddrs to listen on
 *   RELAY_ANNOUNCE_ADDRESSES  - Public multiaddrs to announce (for NAT)
 *   RELAY_PRIVATE_KEY_PATH    - Path to persistent identity file
 *   RELAY_MAX_CONNECTIONS     - Max concurrent connections (default: 1000)
 *   RELAY_BOOTSTRAP_PEERS     - Other relay nodes to connect to
 *   RELAY_ENABLE_METRICS      - Enable metrics endpoint (default: false)
 *   RELAY_METRICS_PORT        - Metrics HTTP port (default: 9090)
 */

import { RelayNode } from './relay-node.js';
import { loadConfig } from './config.js';
import * as http from 'http';

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║     ByteCave Relay Node v1.0.0         ║');
  console.log('║     Bootstrap + Circuit Relay          ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');

  const config = loadConfig();

  console.log('[Config] Listen addresses:', config.listenAddresses);
  if (config.announceAddresses.length > 0) {
    console.log('[Config] Announce addresses:', config.announceAddresses);
  }
  if (config.bootstrapPeers.length > 0) {
    console.log('[Config] Bootstrap peers:', config.bootstrapPeers.length);
  }
  console.log('[Config] Max connections:', config.maxConnections);
  console.log('');

  const relay = new RelayNode(config);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Relay] Received SIGINT, shutting down...');
    await relay.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Relay] Received SIGTERM, shutting down...');
    await relay.stop();
    process.exit(0);
  });

  try {
    await relay.start();

    // Start HTTP health endpoint
    const healthPort = parseInt(process.env.RELAY_HEALTH_PORT || '9090');
    const server = http.createServer((req, res) => {
      if (req.url === '/health' || req.url === '/') {
        const stats = relay.getStats();
        const health = {
          status: 'healthy',
          uptime: stats.uptime,
          nodeId: 'relay',
          isRelay: true,
          storedBlobs: 0,
          totalSize: 0,
          peers: stats.connections,
          p2p: {
            connected: stats.connections,
            replicating: 0,
            relay: stats.relayedConnections
          },
          peerId: stats.peerId,
          metrics: {
            requestsLastHour: 0,
            avgResponseTime: 0,
            successRate: 1
          }
        };
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(health, null, 2));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    server.listen(healthPort, async () => {
      console.log(`[Health] HTTP endpoint listening on port ${healthPort}`);
      console.log(`[Health] Access at http://localhost:${healthPort}/health`);
      
      // Set HTTP URL in peer metadata for discovery
      // Use localhost for local dev, or set RELAY_HTTP_URL for production (e.g., https://relay.hashd.social:9090)
      const httpUrl = process.env.RELAY_HTTP_URL || `http://localhost:${healthPort}`;
      await relay.setHttpMetadata(httpUrl);
      
      // Also announce via pubsub for backwards compatibility
      relay.announceHttpEndpoint(httpUrl);
      console.log(`[Health] HTTP URL for peer discovery: ${httpUrl}`);
    });

    // Print stats periodically
    setInterval(() => {
      const stats = relay.getStats();
      console.log(`[Stats] Connections: ${stats.connections} | Relayed: ${stats.relayedConnections} | Rejected: ${stats.rejectedConnections} | Uptime: ${Math.floor(stats.uptime / 60)}m`);
      console.log(`[RateLimit] Tracked: ${stats.rateLimit.totalPeers} peers | Blocked: ${stats.rateLimit.blockedPeers} peers, ${stats.rateLimit.blockedIPs} IPs`);
    }, 60000); // Every minute

  } catch (error) {
    console.error('[Relay] Failed to start:', error);
    process.exit(1);
  }
}

main().catch(console.error);
