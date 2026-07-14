FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/package.json
COPY packages/p2p/package.json packages/p2p/package.json
COPY services/auth/package.json services/auth/package.json
COPY services/control-plane/package.json services/control-plane/package.json
COPY services/ingest/package.json services/ingest/package.json
COPY services/retention-worker/package.json services/retention-worker/package.json
COPY services/tracker/package.json services/tracker/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace @swarmcast/tracker --workspace @swarmcast/config
COPY packages/config/src packages/config/src
COPY services/tracker/src services/tracker/src
WORKDIR /app/services/tracker
USER node
CMD ["node", "src/index.js"]
