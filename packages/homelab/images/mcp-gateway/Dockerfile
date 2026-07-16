# Custom mcp-gateway image.
#
# Translated from the old Dagger recipe (buildMcpGatewayImageHelper). A Node
# builder clones + builds edstem-mcp (rob-9/edstem-mcp) at a pinned commit — it
# is git-only, has no committed dist, and no build-on-install, so npx-from-git
# fails — then the prebuilt server is copied into the tbxark/mcp-proxy runtime
# image. The gateway config runs it via `node /opt/edstem-mcp/dist/index.js`.
# The base already ships node + python/uv, so the other MCP servers keep running
# via npx/uvx at runtime.

# Stage 1 — clone + build edstem-mcp into /opt/edstem-mcp.
# renovate: datasource=docker depName=node
FROM node:24-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Pinned commit of rob-9/edstem-mcp. Bump to pick up upstream fixes (changes the
# build cache key). Not renovate-managed (git-only dep, no tags to track).
ARG EDSTEM_MCP_COMMIT=661a3c498c82f47b1d352410b53fa06c6806c949

RUN set -e \
  && git clone https://github.com/rob-9/edstem-mcp /opt/edstem-mcp \
  && cd /opt/edstem-mcp \
  && git checkout "${EDSTEM_MCP_COMMIT}" \
  && npm ci \
  && npm run build \
  && npm prune --omit=dev

# Stage 2 — bake the prebuilt server into the mcp-proxy runtime image.
# renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver depName=tbxark/mcp-proxy
FROM ghcr.io/tbxark/mcp-proxy:v0.43.2@sha256:1c43164a910a4f74a3ce48d95cb2ef792de8d467296555e63944fa798f0a44bd

COPY --from=builder /opt/edstem-mcp /opt/edstem-mcp

LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
