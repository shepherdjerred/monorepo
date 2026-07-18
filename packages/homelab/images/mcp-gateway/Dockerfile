# Custom mcp-gateway image.
#
# Translated from the old Dagger recipe (buildMcpGatewayImageHelper). A Node
# builder fetches + builds edstem-mcp (rob-9/edstem-mcp) at a pinned commit — it
# is git-only, has no committed dist, and no build-on-install, so npx-from-git
# fails — then the prebuilt server is copied into the tbxark/mcp-proxy runtime
# image. The gateway config runs it via `node /opt/edstem-mcp/dist/index.js`.
# The base already ships node + python/uv, so the other MCP servers keep running
# via npx/uvx at runtime.

# Stage 1 — fetch + build edstem-mcp into /opt/edstem-mcp.
# renovate: datasource=docker depName=node
FROM node:24-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Pinned commit of rob-9/edstem-mcp. Bump to pick up upstream fixes (changes the
# build cache key). Not renovate-managed (git-only dep, no tags to track).
ARG EDSTEM_MCP_COMMIT=661a3c498c82f47b1d352410b53fa06c6806c949

# Depth-1 fetch of the pinned commit instead of a full clone: the full-history
# transfer died mid-clone on a connection reset (build 5656). A single-commit
# fetch is a small transfer, git still cryptographically verifies the objects
# against the pinned SHA (unlike a tarball, whose auto-generated checksum
# GitHub does not guarantee stable), and transient network failures get a
# bounded retry.
RUN set -e \
  && git init -q /opt/edstem-mcp \
  && cd /opt/edstem-mcp \
  && git remote add origin https://github.com/rob-9/edstem-mcp \
  && for i in 1 2 3 4 5; do \
       if git fetch -q --depth 1 origin "${EDSTEM_MCP_COMMIT}"; then break; fi; \
       if [ "$i" = 5 ]; then echo "git fetch failed after 5 attempts" >&2; exit 1; fi; \
       sleep 5; \
     done \
  && git checkout -q FETCH_HEAD \
  && npm ci \
  && npm run build \
  && npm prune --omit=dev

# Stage 2 — bake the prebuilt server into the mcp-proxy runtime image.
# renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver depName=tbxark/mcp-proxy
FROM ghcr.io/tbxark/mcp-proxy:v0.43.2@sha256:1c43164a910a4f74a3ce48d95cb2ef792de8d467296555e63944fa798f0a44bd

COPY --from=builder /opt/edstem-mcp /opt/edstem-mcp

LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
