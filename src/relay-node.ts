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
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { identify } from '@libp2p/identify';
import { bootstrap } from '@libp2p/bootstrap';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { dcutr } from '@libp2p/dcutr';
import * as fs from 'fs';
import * as path from 'path';
import type { RelayConfig } from './config.js';

const ANNOUNCE_TOPIC = 'bytecave-announce';

export class RelayNode {
  private node: Libp2p | null = null;
  private config: RelayConfig;
  private startTime: number = 0;
  private connectionCount: number = 0;
  private relayedConnections: number = 0;

  constructor(config: RelayConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    console.log('[Relay] Starting ByteCave Relay Node...');

    const services: any = {
      identify: identify(),
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: true
      }),
      relay: circuitRelayServer({
        reservations: {
          maxReservations: this.config.maxConnections,
          defaultDurationLimit: 2 * 60 * 1000, // 2 minutes
          defaultDataLimit: BigInt(1024 * 1024 * 10) // 10MB
        }
      }),
      dcutr: dcutr()
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

    await this.node.start();
    this.startTime = Date.now();

    const peerId = this.node.peerId.toString();
    const addrs = this.node.getMultiaddrs().map(ma => ma.toString());

    console.log('[Relay] ✓ Relay node started');
    console.log('[Relay] Peer ID:', peerId);
    console.log('[Relay] Listening on:');
    addrs.forEach(addr => console.log('  ', addr));

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
      this.connectionCount++;
      console.log('[Relay] Peer connected:', event.detail.toString().slice(0, 16) + '...', `(${this.connectionCount} total)`);
    });

    this.node.addEventListener('peer:disconnect', (event) => {
      this.connectionCount = Math.max(0, this.connectionCount - 1);
      console.log('[Relay] Peer disconnected:', event.detail.toString().slice(0, 16) + '...', `(${this.connectionCount} total)`);
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
    if (!pubsub) return;

    pubsub.subscribe(ANNOUNCE_TOPIC);
    pubsub.addEventListener('message', (event: any) => {
      if (event.detail.topic === ANNOUNCE_TOPIC) {
        // Just log announcements - relay doesn't need to act on them
        console.log('[Relay] Peer announcement received');
      }
    });
  }

  getStats(): {
    peerId: string;
    uptime: number;
    connections: number;
    relayedConnections: number;
    addresses: string[];
  } {
    if (!this.node) {
      return {
        peerId: '',
        uptime: 0,
        connections: 0,
        relayedConnections: 0,
        addresses: []
      };
    }

    return {
      peerId: this.node.peerId.toString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      connections: this.node.getPeers().length,
      relayedConnections: this.relayedConnections,
      addresses: this.node.getMultiaddrs().map(ma => ma.toString())
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
