FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile || yarn install

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build
RUN yarn build

# Create data directory for persistent identity
RUN mkdir -p /data

# Default environment
ENV RELAY_LISTEN_ADDRESSES=/ip4/0.0.0.0/tcp/4001,/ip4/0.0.0.0/tcp/4002/ws
ENV RELAY_PRIVATE_KEY_PATH=/data/relay-key.json
ENV RELAY_MAX_CONNECTIONS=1000

# Expose ports
EXPOSE 4001 4002

CMD ["node", "dist/index.js"]
