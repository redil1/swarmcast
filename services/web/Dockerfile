ARG NODE_BUILDER_IMAGE=node:22-trixie-slim@sha256:e6d9a389d34ff9678438af985c9913fbd1eb6ed36e80fea56644f4b4f6dd70ba
ARG NODE_RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian13:nonroot@sha256:a2723a2817c5b01b8e7b98d567bc8b5a6b0e713e25bfb0a82b6ade4b9db06f50

FROM ${NODE_BUILDER_IMAGE} AS build
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
COPY services/web/package.json services/web/package.json
RUN npm ci --ignore-scripts --workspace @swarmcast/web
COPY services/web/build.js services/web/build.js
COPY services/web/client services/web/client
COPY services/web/src services/web/src
RUN npm run build --workspace @swarmcast/web

FROM ${NODE_RUNTIME_IMAGE}
WORKDIR /app
COPY --from=build --chown=65532:65532 /app/services/web/dist services/web/dist
COPY --from=build --chown=65532:65532 /app/services/web/src services/web/src
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:7030/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["services/web/src/server.js"]
