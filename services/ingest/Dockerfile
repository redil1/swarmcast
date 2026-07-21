ARG NODE_ALPINE_IMAGE=node:22-alpine3.23@sha256:8516dce0483394d5708d4b2ee6cacb79fb1d617ea4e2787c2120bcca92ce372e

FROM ${NODE_ALPINE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/package.json
COPY packages/p2p/package.json packages/p2p/package.json
COPY packages/segment-bus/package.json packages/segment-bus/package.json
COPY services/auth/package.json services/auth/package.json
COPY services/control-plane/package.json services/control-plane/package.json
COPY services/ingest/package.json services/ingest/package.json
COPY services/retention-worker/package.json services/retention-worker/package.json
COPY services/tracker/package.json services/tracker/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace @swarmcast/ingest --workspace @swarmcast/config --workspace @swarmcast/segment-bus
COPY packages/config/src packages/config/src
COPY packages/segment-bus/src packages/segment-bus/src
COPY services/ingest/src services/ingest/src

FROM ${NODE_ALPINE_IMAGE}
USER root
RUN apk upgrade --no-cache \
    && apk add --no-cache ffmpeg \
    && rm -rf /usr/local/lib/node_modules \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /var/hls && chown -R node:node /var/hls
WORKDIR /app/services/ingest
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 CMD ["/usr/local/bin/node", "-e", "fetch('http://127.0.0.1:7001/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/index.js"]
