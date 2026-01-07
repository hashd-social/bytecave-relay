# ByteCave Relay Node

A production-ready libp2p relay node that provides NAT traversal and peer discovery for the ByteCave decentralized storage network.

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
- **HTTP Info Endpoint** - Relay information and stats
- **Health Monitoring** - Built-in metrics and health checks

## Quick Start

### Using Docker (Recommended)

```bash
# Start relay node
docker-compose up -d relay1

# View logs
docker-compose logs -f relay1

# Get relay multiaddr
docker-compose logs relay1 | grep "Peer ID"
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
| `RELAY_INFO_PORT` | `9090` | HTTP info endpoint port |
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

# WebSocket for browsers
sudo ufw allow 4002/tcp

# Metrics (optional, restrict to monitoring IPs)
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

## HTTP Info Endpoint

The relay exposes an HTTP endpoint for node operators to discover relay information:

### Get Relay Info

```bash
# Get relay peer ID and addresses
curl http://relayer.hashd.social:9090/info

# Or for local testing
curl http://localhost:9090/info
```

**Response:**
```json
{
  "peerId": "12D3KooW...",
  "addresses": [
    "/ip4/0.0.0.0/tcp/4001/p2p/12D3KooW...",
    "/ip4/0.0.0.0/tcp/4002/ws/p2p/12D3KooW..."
  ],
  "announceAddresses": [
    "/dns4/relayer.hashd.social/tcp/4001",
    "/dns4/relayer.hashd.social/tcp/4002/ws"
  ],
  "uptime": 7200,
  "connections": 45,
  "relayedConnections": 123,
  "rejectedConnections": 3,
  "rateLimit": {
    "totalPeers": 67,
    "blockedPeers": 2,
    "blockedIPs": 1,
    "activeConnections": 45
  },
  "version": "1.0.0"
}
```

### Health Check

```bash
curl http://localhost:9090/health
```

**Response:**
```json
{
  "status": "healthy",
  "uptime": 7200
}
```

### For Node Operators

When configuring your storage node, use the relay's announce addresses:

```bash
# Get the relay multiaddr
curl http://relayer.hashd.social:9090/info | jq -r '.announceAddresses[0]'

# Use in your node config
P2P_RELAY_PEERS=/dns4/relayer.hashd.social/tcp/4001/p2p/PEER_ID
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
- Ports 4001, 4002 accessible from internet
- Node.js 22+ (for manual installation)

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
