ARG NODE_BUILDER_IMAGE=node:22-trixie-slim@sha256:e6d9a389d34ff9678438af985c9913fbd1eb6ed36e80fea56644f4b4f6dd70ba
ARG NODE_RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian13:nonroot@sha256:a2723a2817c5b01b8e7b98d567bc8b5a6b0e713e25bfb0a82b6ade4b9db06f50

FROM ${NODE_BUILDER_IMAGE} AS build
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
RUN mkdir -p /data

FROM ${NODE_RUNTIME_IMAGE}
WORKDIR /app
COPY --from=build --chown=65532:65532 /app /app
COPY --from=build --chown=65532:65532 /data /data
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:7020/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["services/retention-worker/src/index.js"]
