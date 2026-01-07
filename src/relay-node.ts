/**
 * ByteCave Relay Node
 * 
 * A lightweight libp2p node that serves as:
 * - Bootstrap node: Known entry point for peer discovery
 * - Relay node: Circuit relay for NAT traversal
 * - DHT server: Helps peers find each other
 * 
 * This node does NOT store data - it only facilitates connections.
 */

import { createLibp2p, Libp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { kadDHT } from '@libp2p/kad-dht';
import { floodsub } from '@libp2p/floodsub';
import { identify } from '@libp2p/identify';
import { bootstrap } from '@libp2p/bootstrap';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { dcutr } from '@libp2p/dcutr';
import * as fs from 'fs';
import * as path from 'path';
import type { RelayConfig } from './config.js';
import { RateLimiter } from './rate-limiter.js';

const ANNOUNCE_TOPIC = 'bytecave-announce';
const BROADCAST_TOPIC = 'bytecave-broadcast';
const PROTOCOL_PEER_DIRECTORY = '/bytecave/relay/peers/1.0.0';

interface StorageNodeInfo {
  peerId: string;
  multiaddrs: string[];
  lastSeen: number;
}

export class RelayNode {
  private node: Libp2p | null = null;
  private config: RelayConfig;
  private startTime: number = 0;
  private connectionCount: number = 0;
  private relayedConnections: number = 0;
  private rateLimiter: RateLimiter;
  private rejectedConnections: number = 0;
  private storageNodes: Map<string, StorageNodeInfo> = new Map();

  constructor(config: RelayConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter({
      maxConnectionsPerPeer: 5,
      maxConnectionsPerIP: 20,
      connectionWindowMs: 60000,
      maxBandwidthPerPeerMbps: 10,
      globalMaxConnections: config.maxConnections,
      blockDurationMs: 300000
    });
  }

  async start(): Promise<void> {
    console.log('[Relay] Starting ByteCave Relay Node...');

    const services: any = {
      identify: identify(),
      relay: circuitRelayServer({
        reservations: {
          maxReservations: this.config.maxConnections,
          defaultDurationLimit: 2 * 60 * 1000, // 2 minutes
          defaultDataLimit: BigInt(1024 * 1024 * 10), // 10MB
          applyDefaultLimit: true
        }
      }),
      dcutr: dcutr(),
      pubsub: floodsub()
    };

    // Only enable DHT if explicitly enabled (defaults to true for production)
    if (this.config.enableDHT !== false) {
      services.dht = kadDHT({
        clientMode: false // Server mode - actively participate in DHT
      });
    }

    const peerDiscovery: any[] = [];

    if (this.config.bootstrapPeers.length > 0) {
      peerDiscovery.push(bootstrap({
        list: this.config.bootstrapPeers
      }));
    }

    // Load or generate persistent identity
    let privateKey: any;
    if (this.config.privateKeyPath) {
      privateKey = await this.loadOrCreatePrivateKey(this.config.privateKeyPath);
    }

    this.node = await createLibp2p({
      privateKey,
      addresses: {
        listen: this.config.listenAddresses,
        announce: this.config.announceAddresses.length > 0 ? this.config.announceAddresses : undefined
      },
      transports: [
        tcp(),
        webSockets()
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services,
      peerDiscovery: peerDiscovery.length > 0 ? peerDiscovery : undefined,
      connectionManager: {
        maxConnections: this.config.maxConnections
      }
    });

    this.setupEventListeners();
    await this.setupPubsub();
    this.setupPeerDirectory();

    await this.node.start();
    this.startTime = Date.now();

    const peerId = this.node.peerId.toString();
    const addrs = this.node.getMultiaddrs().map(ma => ma.toString());

    console.log('[Relay] ✓ Relay node started');
    console.log('[Relay] Peer ID:', peerId);
    console.log('[Relay] Listening on:');
    addrs.forEach(addr => console.log('  ', addr));
    
    // Log registered protocols for debugging
    const protocols = await this.node.peerStore.get(this.node.peerId);
    console.log('[Relay] Registered protocols:', protocols?.protocols || []);

    if (this.config.announceAddresses.length > 0) {
      console.log('[Relay] Announcing as:');
      this.config.announceAddresses.forEach(addr => console.log('  ', addr));
    }

    console.log('[Relay] Ready to accept connections');
  }

  async stop(): Promise<void> {
    if (this.node) {
      console.log('[Relay] Stopping relay node...');
      await this.node.stop();
      this.node = null;
      this.rateLimiter.stop();
      console.log('[Relay] Stopped');
    }
  }

  private async loadOrCreatePrivateKey(keyPath: string): Promise<any> {
    const { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } = await import('@libp2p/crypto/keys');
    
    const fullPath = path.resolve(keyPath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(fullPath)) {
      console.log('[Relay] Loading existing identity from', fullPath);
      const keyData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      return privateKeyFromProtobuf(Buffer.from(keyData.privateKey, 'base64'));
    } else {
      console.log('[Relay] Generating new identity...');
      const privateKey = await generateKeyPair('Ed25519');
      const keyData = {
        privateKey: Buffer.from(privateKeyToProtobuf(privateKey)).toString('base64')
      };
      fs.writeFileSync(fullPath, JSON.stringify(keyData, null, 2));
      console.log('[Relay] Identity saved to', fullPath);
      return privateKey;
    }
  }

  private setupEventListeners(): void {
    if (!this.node) return;

    this.node.addEventListener('peer:connect', (event) => {
      const peerId = event.detail.toString();
      
      // Rate limit check
      const rateCheck = this.rateLimiter.allowConnection(peerId);
      if (!rateCheck.allowed) {
        this.rejectedConnections++;
        console.log('[Relay] Connection rejected:', peerId.slice(0, 16) + '...', '-', rateCheck.reason);
        // Note: libp2p doesn't provide a way to reject here, connection is already established
        // We track it for metrics and the peer will be disconnected if it violates limits
        return;
      }

      this.connectionCount++;
      console.log('[Relay] Peer connected:', peerId.slice(0, 16) + '...', `(${this.connectionCount} total)`);
    });

    this.node.addEventListener('peer:disconnect', (event) => {
      const peerId = event.detail.toString();
      this.rateLimiter.recordDisconnection(peerId);
      this.connectionCount = Math.max(0, this.connectionCount - 1);
      console.log('[Relay] Peer disconnected:', peerId.slice(0, 16) + '...', `(${this.connectionCount} total)`);
    });

    // Track relay reservations
    this.node.addEventListener('relay:reservation' as any, () => {
      this.relayedConnections++;
      console.log('[Relay] New relay reservation (total:', this.relayedConnections + ')');
    });
  }

  private async setupPubsub(): Promise<void> {
    if (!this.node) return;

    const pubsub = this.node.services.pubsub as any;
    if (!pubsub) {
      console.log('[Relay] WARNING: Pubsub service not available');
      return;
    }

    console.log('[Relay] Setting up pubsub, subscribing to topics:', ANNOUNCE_TOPIC, BROADCAST_TOPIC);
    pubsub.subscribe(ANNOUNCE_TOPIC);
    pubsub.subscribe(BROADCAST_TOPIC);
    console.log('[Relay] Subscribed to announce and broadcast topics');
    
    pubsub.addEventListener('message', (event: any) => {
      if (event.detail.topic === ANNOUNCE_TOPIC) {
        const from = event.detail.from.toString();
        console.log('[Relay] Peer announcement received from:', from);
        
        // Track storage nodes from announcements
        try {
          const announcement = JSON.parse(new TextDecoder().decode(event.detail.data));
          if (announcement.nodeId && !announcement.isRelay) {
            // Get peer's multiaddrs via circuit relay
            const relayMultiaddrs = this.node!.getMultiaddrs()
              .filter(ma => ma.toString().includes('/ws'))
              .map(ma => `${ma.toString()}/p2p-circuit/p2p/${from}`);
            
            this.storageNodes.set(from, {
              peerId: from,
              multiaddrs: relayMultiaddrs,
              lastSeen: Date.now()
            });
            
            console.log('[Relay] Tracked storage node:', announcement.nodeId, '(' + from.slice(0, 12) + '...)');
          }
        } catch (err) {
          // Ignore parse errors
        }
      }
    });
    
    // Cleanup stale nodes every minute
    setInterval(() => {
      const now = Date.now();
      const staleThreshold = 5 * 60 * 1000; // 5 minutes
      
      for (const [peerId, info] of this.storageNodes.entries()) {
        if (now - info.lastSeen > staleThreshold) {
          this.storageNodes.delete(peerId);
          console.log('[Relay] Removed stale storage node:', peerId.slice(0, 12) + '...');
        }
      }
    }, 60000);
  }

  private setupPeerDirectory(): void {
    if (!this.node) return;

    console.log('[Relay] Setting up peer directory protocol:', PROTOCOL_PEER_DIRECTORY);

    this.node.handle(PROTOCOL_PEER_DIRECTORY, async (stream: any) => {
      try {
        console.log('[Relay] Peer directory request received');
        
        // Build peer list with circuit relay addresses
        const peers = Array.from(this.storageNodes.values()).map(node => ({
          peerId: node.peerId,
          multiaddrs: node.multiaddrs,
          lastSeen: node.lastSeen
        }));
        
        const response = {
          peers,
          timestamp: Date.now()
        };
        
        const responseData = new TextEncoder().encode(JSON.stringify(response));
        
        // Send length prefix (4 bytes, big-endian)
        const lengthPrefix = new Uint8Array(4);
        new DataView(lengthPrefix.buffer).setUint32(0, responseData.length, false);
        
        // Combine and send
        const combined = new Uint8Array(lengthPrefix.length + responseData.length);
        combined.set(lengthPrefix, 0);
        combined.set(responseData, lengthPrefix.length);
        
        stream.send(combined);
        await stream.close();
        
        console.log('[Relay] Sent peer directory:', peers.length, 'peers');
      } catch (error: any) {
        console.error('[Relay] Peer directory error:', error.message);
      }
    });
    
    console.log('[Relay] Peer directory protocol registered');
  }

  async setHttpMetadata(httpUrl: string): Promise<void> {
    if (!this.node) return;

    try {
      const httpUrlBytes = new TextEncoder().encode(httpUrl);
      await this.node.peerStore.merge(this.node.peerId, {
        metadata: {
          httpUrl: httpUrlBytes
        }
      });
      console.log('[Relay] Set HTTP URL in peer metadata:', httpUrl);
    } catch (error) {
      console.error('[Relay] Failed to set HTTP metadata:', error);
    }
  }

  announceHttpEndpoint(httpUrl: string): void {
    if (!this.node) return;

    const pubsub = this.node.services.pubsub as any;
    if (!pubsub) {
      console.log('[Relay] Cannot announce HTTP endpoint - pubsub not available');
      return;
    }

    const announcement = {
      peerId: this.node.peerId.toString(),
      httpEndpoint: httpUrl,
      contentTypes: 'all' as const,
      nodeId: 'relay',
      isRelay: true,
      timestamp: Date.now()
    };

    const message = new TextEncoder().encode(JSON.stringify(announcement));
    pubsub.publish(ANNOUNCE_TOPIC, message);
    console.log('[Relay] Announced HTTP endpoint:', httpUrl);
  }

  getStats(): {
    peerId: string;
    uptime: number;
    connections: number;
    relayedConnections: number;
    rejectedConnections: number;
    addresses: string[];
    rateLimit: {
      totalPeers: number;
      blockedPeers: number;
      blockedIPs: number;
      activeConnections: number;
    };
  } {
    if (!this.node) {
      return {
        peerId: '',
        uptime: 0,
        connections: 0,
        relayedConnections: 0,
        rejectedConnections: 0,
        addresses: [],
        rateLimit: {
          totalPeers: 0,
          blockedPeers: 0,
          blockedIPs: 0,
          activeConnections: 0
        }
      };
    }

    return {
      peerId: this.node.peerId.toString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      connections: this.node.getPeers().length,
      relayedConnections: this.relayedConnections,
      rejectedConnections: this.rejectedConnections,
      addresses: this.node.getMultiaddrs().map(ma => ma.toString()),
      rateLimit: this.rateLimiter.getStats()
    };
  }

  getPeerId(): string | null {
    return this.node?.peerId.toString() || null;
  }

  getMultiaddrs(): string[] {
    return this.node?.getMultiaddrs().map(ma => ma.toString()) || [];
  }

  isRunning(): boolean {
    return this.node !== null;
  }
}
