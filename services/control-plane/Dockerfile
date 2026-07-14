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
RUN npm ci --omit=dev --ignore-scripts --workspace @swarmcast/control-plane --workspace @swarmcast/config
COPY packages/config/src packages/config/src
COPY services/control-plane/src services/control-plane/src
COPY services/ingest/src/catalog.js services/ingest/src/catalog.js
WORKDIR /app/services/control-plane
USER node
CMD ["node", "src/index.js"]
