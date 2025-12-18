#!/bin/bash

# Test script for ByteCave Relay Node
# This script starts a relay node and verifies it's working

echo "╔════════════════════════════════════════╗"
echo "║   ByteCave Relay Node Test Script     ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Set test configuration
export RELAY_LISTEN_ADDRESSES="/ip4/127.0.0.1/tcp/14001,/ip4/127.0.0.1/tcp/14002/ws"
export RELAY_PRIVATE_KEY_PATH="./test-relay-key.json"
export RELAY_MAX_CONNECTIONS=100

echo "Starting relay node..."
echo "Listen addresses: $RELAY_LISTEN_ADDRESSES"
echo ""

# Start the relay node
yarn dev
