FROM node:22-alpine

# Create non-root user
RUN addgroup -g 1001 -S relay && \
    adduser -S -u 1001 -G relay relay

WORKDIR /app

# Install dependencies
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile || yarn install

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build
RUN yarn build

# Remove dev dependencies and clean cache
RUN yarn install --production --ignore-scripts --prefer-offline && \
    yarn cache clean

# Create data directory for persistent identity
RUN mkdir -p /data && \
    chown -R relay:relay /app /data

# Switch to non-root user
USER relay

# Default environment variables
ENV RELAY_LISTEN_ADDRESSES=/ip4/0.0.0.0/tcp/4001,/ip4/0.0.0.0/tcp/4002/ws
ENV RELAY_ANNOUNCE_ADDRESSES=
ENV RELAY_PRIVATE_KEY_PATH=/data/relay-key.json
ENV RELAY_MAX_CONNECTIONS=1000
ENV RELAY_ENABLE_METRICS=false
ENV RELAY_METRICS_PORT=9090
ENV RELAY_BOOTSTRAP_PEERS=

# Expose ports
EXPOSE 4001 4002 9090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('net').connect(4001, 'localhost').on('connect', () => process.exit(0)).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
