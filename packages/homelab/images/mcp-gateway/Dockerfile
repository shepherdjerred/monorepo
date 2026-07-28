# Custom mcp-gateway image.
#
# Translated from the old Dagger recipe (buildMcpGatewayImageHelper). A Node
# builder fetches + builds edstem-mcp (rob-9/edstem-mcp) at a pinned commit — it
# is git-only, has no committed dist, and no build-on-install, so npx-from-git
# fails — then the prebuilt server is copied into the tbxark/mcp-proxy runtime
# image. This stage also downloads and verifies GitHub's supported MCP server
# binary. The base already ships node + python/uv, so the remaining MCP servers
# keep running via npx/uvx at runtime.

# Stage 1 — fetch + build edstem-mcp into /opt/edstem-mcp.
# renovate: datasource=docker depName=node
FROM node:24-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Pinned commit of rob-9/edstem-mcp. Bump to pick up upstream fixes (changes the
# build cache key). Not renovate-managed (git-only dep, no tags to track).
ARG EDSTEM_MCP_COMMIT=661a3c498c82f47b1d352410b53fa06c6806c949

# renovate: datasource=github-releases depName=github/github-mcp-server
ARG GITHUB_MCP_SERVER_VERSION=1.3.0

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

RUN set -e \
  && arch="$(dpkg --print-architecture)" \
  && case "$arch" in amd64) gmsarch=x86_64 ;; arm64) gmsarch=arm64 ;; \
       *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac \
  && base="https://github.com/github/github-mcp-server/releases/download/v${GITHUB_MCP_SERVER_VERSION}" \
  && tarball="github-mcp-server_Linux_${gmsarch}.tar.gz" \
  && curl -fsSL "$base/$tarball" -o /tmp/github-mcp-server.tar.gz \
  && curl -fsSL "$base/github-mcp-server_${GITHUB_MCP_SERVER_VERSION}_checksums.txt" -o /tmp/github-mcp-server.checksums \
  && expected="$(grep " $tarball$" /tmp/github-mcp-server.checksums | awk '{print $1}')" \
  && test -n "$expected" \
  && actual="$(sha256sum /tmp/github-mcp-server.tar.gz | awk '{print $1}')" \
  && test "$expected" = "$actual" \
  && mkdir -p /out \
  && tar -xzf /tmp/github-mcp-server.tar.gz -C /out github-mcp-server \
  && chmod +x /out/github-mcp-server \
  && /out/github-mcp-server --version

# Stage 2 — bake the prebuilt server into the mcp-proxy runtime image.
# renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver depName=tbxark/mcp-proxy
FROM ghcr.io/tbxark/mcp-proxy:v0.43.2@sha256:70c0e02d39c4c0898e610b3a30954f7930628fa6f4fb447bad14c32382a25879 AS runtime

COPY --from=builder /opt/edstem-mcp /opt/edstem-mcp
COPY --from=builder /out/github-mcp-server /usr/local/bin/github-mcp-server

LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

FROM runtime AS smoke
RUN node --version \
  && github-mcp-server --version \
  && test -f /opt/edstem-mcp/dist/index.js \
  && node --check /opt/edstem-mcp/dist/index.js \
  && node --input-type=module -e "import { readFileSync, existsSync } from 'node:fs'; const pkg = JSON.parse(readFileSync('/opt/edstem-mcp/package.json', 'utf8')); const missing = Object.keys(pkg.dependencies ?? {}).filter((dependency) => !existsSync('/opt/edstem-mcp/node_modules/' + dependency)); if (missing.length > 0) { throw new Error('missing production dependencies: ' + missing.join(', ')); }"

FROM runtime AS image
