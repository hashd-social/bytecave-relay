# ByteCave Relay Node

A lightweight libp2p relay and bootstrap node for the ByteCave P2P network.

## What It Does

- **Bootstrap**: Known entry point for peer discovery
- **Circuit Relay**: Allows NAT'd peers to connect through it
- **DHT Server**: Helps peers find each other
- **Gossipsub**: Propagates peer announcements

This node does NOT store data - it only facilitates connections.

## Quick Start

```bash
# Install dependencies
yarn install

# Run in development
yarn dev

# Build and run
yarn build
yarn start
```

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `RELAY_LISTEN_ADDRESSES` | Comma-separated multiaddrs to listen on | `/ip4/0.0.0.0/tcp/4001,/ip4/0.0.0.0/tcp/4002/ws` |
| `RELAY_ANNOUNCE_ADDRESSES` | Public multiaddrs to announce (for NAT) | (none) |
| `RELAY_PRIVATE_KEY_PATH` | Path to persistent identity file | (generates new each time) |
| `RELAY_MAX_CONNECTIONS` | Max concurrent connections | `1000` |
| `RELAY_BOOTSTRAP_PEERS` | Other relay nodes to connect to | (none) |

## Docker

```bash
# Build and run single relay
docker build -t bytecave-relay .
docker run -p 4001:4001 -p 4002:4002 -v relay-data:/data bytecave-relay

# Run multiple relays
docker-compose up -d
```

## Connecting Storage Nodes

Configure your bytecave-core nodes to use this relay as a bootstrap peer:

```bash
P2P_BOOTSTRAP_PEERS=/ip4/<RELAY_IP>/tcp/4001/p2p/<RELAY_PEER_ID>
```

The relay's peer ID is printed on startup and remains stable if you use `RELAY_PRIVATE_KEY_PATH`.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    bytecave-relay                           │
│         (Bootstrap + Circuit Relay)                         │
└─────────────────────────────────────────────────────────────┘
           │
           │ Bootstrap multiaddrs known ahead of time
           ▼
┌─────────────────────────────────────────────────────────────┐
│                    bytecave-core                            │
│              (Storage Node)                                 │
│  - Dials bootstrap peers on startup                         │
│  - Uses relay for NAT traversal                             │
└─────────────────────────────────────────────────────────────┘
           │
           │ Connect via relay if behind NAT
           ▼
┌─────────────────────────────────────────────────────────────┐
│               bytecave-browser / dashboard                  │
│                  (Browser Client)                           │
│  - Connects via WebSocket to relay                          │
│  - Uses relay to reach NAT'd storage nodes                  │
└─────────────────────────────────────────────────────────────┘
```

## Mental Model

- **Bootstrap** = "Who can I talk to?"
- **Relay** = "How can I talk to them?"
- **Gossip/DHT** = "Who else exists?"
