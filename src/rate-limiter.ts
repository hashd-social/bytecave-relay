/**
 * Rate Limiter for Relay Node
 * 
 * Implements token bucket algorithm for rate limiting:
 * - Per-peer connection limits
 * - Per-peer bandwidth limits
 * - Global connection limits
 * - IP-based blocking
 */

interface RateLimitConfig {
  maxConnectionsPerPeer: number;
  maxConnectionsPerIP: number;
  connectionWindowMs: number;
  maxBandwidthPerPeerMbps: number;
  globalMaxConnections: number;
  blockDurationMs: number;
}

interface PeerMetrics {
  connections: number;
  lastConnection: number;
  bandwidth: number;
  lastBandwidthReset: number;
  blocked: boolean;
  blockedUntil: number;
}

interface IPMetrics {
  connections: number;
  lastConnection: number;
  peerIds: Set<string>;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private peerMetrics: Map<string, PeerMetrics> = new Map();
  private ipMetrics: Map<string, IPMetrics> = new Map();
  private blockedIPs: Set<string> = new Set();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      maxConnectionsPerPeer: config.maxConnectionsPerPeer || 5,
      maxConnectionsPerIP: config.maxConnectionsPerIP || 20,
      connectionWindowMs: config.connectionWindowMs || 60000, // 1 minute
      maxBandwidthPerPeerMbps: config.maxBandwidthPerPeerMbps || 10,
      globalMaxConnections: config.globalMaxConnections || 1000,
      blockDurationMs: config.blockDurationMs || 300000 // 5 minutes
    };

    // Cleanup old metrics every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check if a peer connection should be allowed
   */
  allowConnection(peerId: string, ip?: string): { allowed: boolean; reason?: string } {
    const now = Date.now();

    // Check global connection limit
    const totalConnections = Array.from(this.peerMetrics.values())
      .filter(m => now - m.lastConnection < this.config.connectionWindowMs)
      .length;

    if (totalConnections >= this.config.globalMaxConnections) {
      return { allowed: false, reason: 'Global connection limit reached' };
    }

    // Check if IP is blocked
    if (ip && this.blockedIPs.has(ip)) {
      return { allowed: false, reason: 'IP address blocked' };
    }

    // Check IP-based limits
    if (ip) {
      const ipCheck = this.checkIPLimit(ip, now);
      if (!ipCheck.allowed) {
        return ipCheck;
      }
    }

    // Check peer-specific limits
    let metrics = this.peerMetrics.get(peerId);
    
    if (!metrics) {
      metrics = {
        connections: 0,
        lastConnection: now,
        bandwidth: 0,
        lastBandwidthReset: now,
        blocked: false,
        blockedUntil: 0
      };
      this.peerMetrics.set(peerId, metrics);
    }

    // Check if peer is temporarily blocked
    if (metrics.blocked && now < metrics.blockedUntil) {
      return { 
        allowed: false, 
        reason: `Peer blocked until ${new Date(metrics.blockedUntil).toISOString()}` 
      };
    }

    // Unblock if block period expired
    if (metrics.blocked && now >= metrics.blockedUntil) {
      metrics.blocked = false;
      metrics.connections = 0;
    }

    // Check connection rate
    if (now - metrics.lastConnection < this.config.connectionWindowMs) {
      if (metrics.connections >= this.config.maxConnectionsPerPeer) {
        // Block peer for repeated violations
        metrics.blocked = true;
        metrics.blockedUntil = now + this.config.blockDurationMs;
        console.log(`[RateLimit] Peer ${peerId.slice(0, 16)}... blocked for ${this.config.blockDurationMs / 1000}s`);
        return { allowed: false, reason: 'Connection rate limit exceeded' };
      }
      metrics.connections++;
    } else {
      // Reset window
      metrics.connections = 1;
      metrics.lastConnection = now;
    }

    return { allowed: true };
  }

  /**
   * Check IP-based connection limits
   */
  private checkIPLimit(ip: string, now: number): { allowed: boolean; reason?: string } {
    let ipMetric = this.ipMetrics.get(ip);

    if (!ipMetric) {
      ipMetric = {
        connections: 1,
        lastConnection: now,
        peerIds: new Set()
      };
      this.ipMetrics.set(ip, ipMetric);
      return { allowed: true };
    }

    // Reset window if expired
    if (now - ipMetric.lastConnection >= this.config.connectionWindowMs) {
      ipMetric.connections = 1;
      ipMetric.lastConnection = now;
      ipMetric.peerIds.clear();
      return { allowed: true };
    }

    // Check limit
    if (ipMetric.connections >= this.config.maxConnectionsPerIP) {
      // Auto-block IPs that consistently exceed limits
      this.blockedIPs.add(ip);
      console.log(`[RateLimit] IP ${ip} blocked for excessive connections`);
      return { allowed: false, reason: 'IP connection limit exceeded' };
    }

    ipMetric.connections++;
    return { allowed: true };
  }

  /**
   * Track bandwidth usage for a peer
   */
  trackBandwidth(peerId: string, bytes: number): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const metrics = this.peerMetrics.get(peerId);

    if (!metrics) {
      return { allowed: true };
    }

    // Reset bandwidth counter every second
    if (now - metrics.lastBandwidthReset >= 1000) {
      metrics.bandwidth = 0;
      metrics.lastBandwidthReset = now;
    }

    metrics.bandwidth += bytes;

    // Convert Mbps to bytes per second
    const maxBytesPerSecond = (this.config.maxBandwidthPerPeerMbps * 1024 * 1024) / 8;

    if (metrics.bandwidth > maxBytesPerSecond) {
      console.log(`[RateLimit] Peer ${peerId.slice(0, 16)}... exceeded bandwidth limit`);
      return { allowed: false, reason: 'Bandwidth limit exceeded' };
    }

    return { allowed: true };
  }

  /**
   * Record a peer disconnection
   */
  recordDisconnection(peerId: string): void {
    const metrics = this.peerMetrics.get(peerId);
    if (metrics && metrics.connections > 0) {
      metrics.connections--;
    }
  }

  /**
   * Manually block a peer
   */
  blockPeer(peerId: string, durationMs?: number): void {
    const metrics = this.peerMetrics.get(peerId) || {
      connections: 0,
      lastConnection: Date.now(),
      bandwidth: 0,
      lastBandwidthReset: Date.now(),
      blocked: false,
      blockedUntil: 0
    };

    metrics.blocked = true;
    metrics.blockedUntil = Date.now() + (durationMs || this.config.blockDurationMs);
    this.peerMetrics.set(peerId, metrics);
    console.log(`[RateLimit] Manually blocked peer ${peerId.slice(0, 16)}...`);
  }

  /**
   * Manually block an IP address
   */
  blockIP(ip: string): void {
    this.blockedIPs.add(ip);
    console.log(`[RateLimit] Manually blocked IP ${ip}`);
  }

  /**
   * Unblock a peer
   */
  unblockPeer(peerId: string): void {
    const metrics = this.peerMetrics.get(peerId);
    if (metrics) {
      metrics.blocked = false;
      metrics.blockedUntil = 0;
      console.log(`[RateLimit] Unblocked peer ${peerId.slice(0, 16)}...`);
    }
  }

  /**
   * Unblock an IP address
   */
  unblockIP(ip: string): void {
    this.blockedIPs.delete(ip);
    console.log(`[RateLimit] Unblocked IP ${ip}`);
  }

  /**
   * Get current stats
   */
  getStats(): {
    totalPeers: number;
    blockedPeers: number;
    blockedIPs: number;
    activeConnections: number;
  } {
    const now = Date.now();
    const blockedPeers = Array.from(this.peerMetrics.values())
      .filter(m => m.blocked && now < m.blockedUntil).length;

    const activeConnections = Array.from(this.peerMetrics.values())
      .filter(m => now - m.lastConnection < this.config.connectionWindowMs)
      .reduce((sum, m) => sum + m.connections, 0);

    return {
      totalPeers: this.peerMetrics.size,
      blockedPeers,
      blockedIPs: this.blockedIPs.size,
      activeConnections
    };
  }

  /**
   * Cleanup old metrics
   */
  private cleanup(): void {
    const now = Date.now();
    const expiryTime = this.config.connectionWindowMs * 2;

    // Clean up peer metrics
    for (const [peerId, metrics] of this.peerMetrics.entries()) {
      if (!metrics.blocked && now - metrics.lastConnection > expiryTime) {
        this.peerMetrics.delete(peerId);
      }
    }

    // Clean up IP metrics
    for (const [ip, metrics] of this.ipMetrics.entries()) {
      if (now - metrics.lastConnection > expiryTime) {
        this.ipMetrics.delete(ip);
      }
    }

    console.log(`[RateLimit] Cleanup: ${this.peerMetrics.size} peers, ${this.ipMetrics.size} IPs tracked`);
  }

  /**
   * Stop the rate limiter
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
