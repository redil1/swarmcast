FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/package.json
COPY packages/p2p/package.json packages/p2p/package.json
COPY services/auth/package.json services/auth/package.json
COPY services/control-plane/package.json services/control-plane/package.json
COPY services/ingest/package.json services/ingest/package.json
COPY services/retention-worker/package.json services/retention-worker/package.json
COPY services/tracker/package.json services/tracker/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace @swarmcast/retention-worker --workspace @swarmcast/config
COPY packages/config/src packages/config/src
COPY scripts/retention-http-store.js scripts/retention-http-store.js
COPY services/retention-worker/src services/retention-worker/src
COPY test-fixtures/retention test-fixtures/retention
RUN mkdir -p /data && chown -R node:node /data
WORKDIR /app/services/retention-worker
USER node
CMD ["node", "src/index.js"]
