# ByteCave Relay Node

ByteCave Relay is a network component that enables peer discovery and connectivity in the ByteCave storage network. Its primary role is to help clients and nodes find each other and establish peer-to-peer connections, especially in cases where direct connections aren’t possible due to NATs or browser limitations.

The relay does not store plaintext data, hold encryption keys, or have any special authority over content. All data passing through the relay is already encrypted client-side. In most cases, the relay is used only during connection setup; once peers can connect directly, traffic can move peer-to-peer without continuing to pass through it.

ByteCave Relays are intentionally simple and replaceable. Anyone can run one, clients can use multiple relays for redundancy, and the network does not rely on a single relay or operator. Relays exist to improve reliability and reachability, not to act as trusted infrastructure.

## Features

- **Circuit Relay v2** - Enables connections between NAT'd peers
- **Peer Directory Protocol** - Fast node discovery for browsers (1-2 seconds)
- **DHT Server** - Distributed peer routing and discovery
- **FloodSub** - Peer announcement and messaging
- **WebSocket Support** - Browser-compatible connections
- **Persistent Identity** - Stable peer ID across restarts
- **Rate Limiting** - Protection against spam and abuse
- **Connection Throttling** - Per-peer and per-IP limits
- **Abuse Prevention** - Automatic blocking for violations
- **HTTP Health Endpoint** - Health checks and relay stats
- **WebSocket Storage Relay** - Routes storage requests between browsers and nodes

## Quick Start

### Using Docker (Recommended)

```bash
# Start relay node
docker-compose up -d relay1

# View logs
docker-compose logs -f relay1

# Get relay peer ID and multiaddrs
docker-compose logs relay1 | grep "Listening on"
```

### Manual Installation

```bash
# Install dependencies
yarn install

# Build
yarn build

# Run
yarn start
```

## Configuration

Configure via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_LISTEN_ADDRESSES` | `/ip4/0.0.0.0/tcp/4001,/ip4/0.0.0.0/tcp/4002/ws` | Addresses to listen on |
| `RELAY_ANNOUNCE_ADDRESSES` | (empty) | Public addresses to announce |
| `RELAY_PRIVATE_KEY_PATH` | `/data/relay-key.json` | Path to identity file |
| `RELAY_MAX_CONNECTIONS` | `1000` | Maximum peer connections |
| `RELAY_HEALTH_PORT` | `9090` | HTTP health endpoint port |
| `RELAY_WS_PORT` | `4003` | WebSocket storage relay port |
| `RELAY_HTTP_URL` | `http://localhost:9090` | Public HTTP URL for peer discovery |
| `RELAY_BOOTSTRAP_PEERS` | (empty) | Bootstrap peer multiaddrs |

### Example Configuration

```bash
# .env
RELAY_LISTEN_ADDRESSES=/ip4/0.0.0.0/tcp/4001,/ip4/0.0.0.0/tcp/4002/ws
RELAY_ANNOUNCE_ADDRESSES=/dns4/relay.yourdomain.com/tcp/4001,/dns4/relay.yourdomain.com/tcp/4002/ws
RELAY_MAX_CONNECTIONS=2000
RELAY_ENABLE_METRICS=true
```

## Production Deployment

### 1. Deploy Relay

```bash
# Update announce addresses in docker-compose.yml
RELAY_ANNOUNCE_ADDRESSES=/dns4/relay.yourdomain.com/tcp/4001,/dns4/relay.yourdomain.com/tcp/4002/ws

# Deploy
docker-compose up -d relay1
```

### 2. Get Relay Multiaddr

```bash
docker-compose logs relay1 | grep "Listening on"
```

Example output:
```
[Relay] Listening on:
   /dns4/relay.yourdomain.com/tcp/4001/p2p/12D3KooW...
   /dns4/relay.yourdomain.com/tcp/4002/ws/p2p/12D3KooW...
```

### 3. Configure Nodes

**For bytecave-core storage nodes:**
```bash
P2P_RELAY_PEERS=/dns4/relay.yourdomain.com/tcp/4001/p2p/RELAY_PEER_ID
```

**For dashboard/browsers:**
```bash
REACT_APP_RELAY_PEERS=/dns4/relay.yourdomain.com/tcp/4002/ws/p2p/RELAY_PEER_ID
```

### 4. Firewall Configuration

Open these ports:

```bash
# TCP for storage nodes
sudo ufw allow 4001/tcp

# WebSocket for browsers (libp2p)
sudo ufw allow 4002/tcp

# WebSocket for storage relay
sudo ufw allow 4003/tcp

# Health endpoint (optional, restrict to monitoring IPs)
sudo ufw allow from MONITORING_IP to any port 9090
```

## Architecture

### Relay Node Role

The relay serves **dual purpose**:

1. **Circuit Relay** - Brokers connections between NAT'd peers
2. **Bootstrap Peer** - Network entry point for peer discovery

### Discovery Flow

```
Node A → Connects to Relay
Node B → Connects to Relay
         ↓
      Relay DHT
         ↓
Node A discovers Node B
         ↓
Circuit relay connection
         ↓
Nodes communicate!
```

### Protocols Used

- **Circuit Relay v2** - NAT traversal
- **Peer Directory** (`/bytecave/relay/peers/1.0.0`) - Fast peer discovery
- **Kad-DHT** - Distributed peer routing
- **FloodSub** - Peer announcements on `bytecave-announce` topic
- **Identify** - Peer capability exchange
- **DCUTR** - Direct connection upgrade

### Peer Directory Protocol

The relay implements a peer directory protocol that enables instant node discovery for browsers:

**How it works:**
1. Storage nodes connect to relay and announce themselves via gossip
2. Relay tracks announced nodes in an in-memory directory
3. Browsers query relay on startup: `/bytecave/relay/peers/1.0.0`
4. Relay responds with list of storage nodes and their circuit relay addresses
5. Browsers dial nodes directly through the relay

**Benefits:**
- **Fast discovery:** 1-2 seconds instead of 2+ minutes
- **No configuration:** No hardcoded peer lists needed
- **Auto-updating:** Relay maintains fresh peer list automatically
- **Stale cleanup:** Nodes not seen for 5 minutes are removed

**Protocol format:**
```typescript
// Request: Empty (just dial the protocol)

// Response: JSON with length prefix
{
  "peers": [
    {
      "peerId": "12D3KooW...",
      "multiaddrs": [
        "/ip4/127.0.0.1/tcp/4002/ws/p2p/RELAY_ID/p2p-circuit/p2p/NODE_ID"
      ],
      "lastSeen": 1704636000000
    }
  ],
  "timestamp": 1704636000000
}
```

## HTTP Endpoints

The relay exposes HTTP endpoints for health monitoring and peer discovery:

### Health Check

```bash
# Get relay health and stats
curl http://localhost:9090/health

# Or for production
curl http://relayer.hashd.social:9090/health
```

**Response:**
```json
{
  "status": "healthy",
  "uptime": 7200,
  "nodeId": "relay",
  "isRelay": true,
  "storedBlobs": 0,
  "totalSize": 0,
  "peers": 45,
  "p2p": {
    "connected": 45,
    "replicating": 0,
    "relay": 123
  },
  "peerId": "12D3KooW...",
  "metrics": {
    "requestsLastHour": 0,
    "avgResponseTime": 0,
    "successRate": 1
  }
}
```

### Get Storage Nodes

```bash
# Get list of connected storage nodes
curl http://localhost:9090/peers
```

**Response:**
```json
[
  {
    "peerId": "12D3KooW...",
    "multiaddrs": [
      "/ip4/127.0.0.1/tcp/4002/ws/p2p/RELAY_ID/p2p-circuit/p2p/NODE_ID"
    ],
    "lastSeen": 1704636000000
  }
]
```

### For Node Operators

When configuring your storage node or browser client, use the relay's multiaddrs:

```bash
# For browser clients (use WebSocket)
REACT_APP_RELAY_PEERS=/dns4/relayer.hashd.social/tcp/4002/ws/p2p/PEER_ID

# For storage nodes (use TCP)
P2P_RELAY_PEERS=/dns4/relayer.hashd.social/tcp/4001/p2p/PEER_ID

# Get peer ID from logs or health endpoint
curl http://relayer.hashd.social:9090/health | grep peerId
```

## Monitoring

### Stats Logging

The relay logs stats every minute:

```bash
docker-compose logs -f relay1
```

Example output:
```
[Stats] Connections: 45 | Relayed: 123 | Rejected: 3 | Uptime: 120m
[RateLimit] Tracked: 67 peers | Blocked: 2 peers, 1 IPs
```

## Troubleshooting

### Relay Not Starting

```bash
# Check logs
docker-compose logs relay1

# Verify ports are available
sudo lsof -i :4001
sudo lsof -i :4002
```

### Nodes Can't Connect

1. Verify relay is healthy: `docker-compose ps`
2. Check firewall allows ports 4001, 4002
3. Verify announce addresses are correct (public IP/domain)
4. Check relay logs for connection attempts

### High Connection Count

Increase max connections:

```yaml
RELAY_MAX_CONNECTIONS=2000
```

## Maintenance

### Backup Identity

```bash
# Backup relay identity
docker cp bytecave-relay-1:/data/relay-key.json ./relay-backup.json

# Restore identity
docker cp ./relay-backup.json bytecave-relay-1:/data/relay-key.json
docker-compose restart relay1
```

### Update Relay

```bash
git pull
docker-compose build
docker-compose up -d
```

## Production Features

### Rate Limiting & Abuse Prevention

The relay includes comprehensive protection against spam and abuse:

- **Per-peer limits:** 5 connections per minute
- **Per-IP limits:** 20 connections per minute  
- **Bandwidth throttling:** 10 Mbps per peer
- **Automatic blocking:** Temporary blocks for violations (5 minutes)
- **IP blocking:** Automatic blocking for excessive connections

See `PRODUCTION_READY.md` for detailed configuration.

## Security

- Runs as non-root user (UID 1001)
- No sensitive data stored except peer identity
- All connections are end-to-end encrypted
- Relay cannot read relayed traffic
- Rate limiting prevents DDoS attacks
- Automatic abuse prevention

## Requirements

- Docker and Docker Compose
- Public IP or domain (for production)
- Ports 4001, 4002, 4003 accessible from internet
- Node.js 22+ (for manual installation)

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
