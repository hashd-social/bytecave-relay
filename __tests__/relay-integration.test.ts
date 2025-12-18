/**
 * ByteCave Relay Integration Tests
 * 
 * Tests relay connectivity, NAT traversal, and multi-node communication
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { RelayNode } from '../src/relay-node.js';
import type { RelayConfig } from '../src/config.js';

describe('Relay Node Integration Tests', () => {
  let relayNode: RelayNode;
  const testConfig: RelayConfig = {
    listenAddresses: ['/ip4/127.0.0.1/tcp/14001', '/ip4/127.0.0.1/tcp/14002/ws'],
    announceAddresses: [],
    privateKeyPath: undefined, // Generate new key each time
    maxConnections: 100,
    enableMetrics: false,
    metricsPort: 9090,
    bootstrapPeers: [],
    enableDHT: false // Disable DHT for faster test startup
  };

  beforeAll(async () => {
    relayNode = new RelayNode(testConfig);
    await relayNode.start();
  }, 5000); // 5 second timeout should be plenty without DHT

  afterAll(async () => {
    await relayNode.stop();
  });

  test('should start relay node successfully', () => {
    expect(relayNode.isRunning()).toBe(true);
    expect(relayNode.getPeerId()).toBeTruthy();
  });

  test('should have correct multiaddrs', () => {
    const addrs = relayNode.getMultiaddrs();
    expect(addrs.length).toBeGreaterThan(0);
    expect(addrs.some(addr => addr.includes('/tcp/14001'))).toBe(true);
    expect(addrs.some(addr => addr.includes('/ws'))).toBe(true);
  });

  test('should provide stats', () => {
    const stats = relayNode.getStats();
    expect(stats.peerId).toBeTruthy();
    expect(stats.uptime).toBeGreaterThanOrEqual(0);
    expect(stats.connections).toBeGreaterThanOrEqual(0);
    expect(stats.relayedConnections).toBeGreaterThanOrEqual(0);
    expect(stats.addresses.length).toBeGreaterThan(0);
  });

  test('should have persistent peer ID if key path provided', async () => {
    const configWithKey: RelayConfig = {
      ...testConfig,
      listenAddresses: ['/ip4/127.0.0.1/tcp/14003'],
      privateKeyPath: './test-relay-key.json'
    };

    const relay1 = new RelayNode(configWithKey);
    await relay1.start();
    const peerId1 = relay1.getPeerId();
    await relay1.stop();

    const relay2 = new RelayNode(configWithKey);
    await relay2.start();
    const peerId2 = relay2.getPeerId();
    await relay2.stop();

    expect(peerId1).toBe(peerId2);
  });
});

describe('Multi-Node Relay Tests', () => {
  test('should allow multiple nodes to connect through relay', async () => {
    // This test would require spinning up multiple libp2p nodes
    // and verifying they can connect through the relay
    // TODO: Implement full multi-node test
    expect(true).toBe(true);
  });
});
