# syntax=docker/dockerfile:1-labs@sha256:7d49dad25a050e14338ba7028b0460243f9d911dedc160a8fe20c34738fef3af
# streambot image. Build context is the REPO ROOT (single Bun workspace, one
# root bun.lock, isolated linker). Built via `bun run docker:build` in this
# package (which passes `-f Dockerfile ../..`).
#
# streambot shells out to ffmpeg (transcode) and a system yt-dlp
# (/usr/local/bin/yt-dlp, config default). The Intel VAAPI iHD hardware-encode
# driver (intel-media-va-driver-non-free) is x86-only and installed amd64-only;
# arm64 builds fall back to software encoding.
#
# Multi-stage: base-build carries the C/C++ toolchain the native
# trustedDependencies postinstalls (node-datachannel, node-av) need during
# `bun install`; BOTH install stages inherit it so the native builds behave
# identically, while the runtime stage keeps only the ffmpeg/VAAPI runtime
# stack — no compilers. Dev dependencies and the rest of the monorepo source
# never reach the final image, and the source layer only invalidates when a
# closure package changes — not on every repo commit.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
WORKDIR /app

# ── base-build: runtime libs + build toolchain for native postinstalls ──────
# Mirrors the old single-stage apt layer exactly (ffmpeg + VAAPI + compilers)
# so the node-datachannel / node-av native builds see the same environment.
FROM base AS base-build
RUN set -e; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's/^Components: main.*/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources; \
    fi; \
    if [ -f /etc/apt/sources.list ]; then \
      sed -i 's/ main$/ main contrib non-free non-free-firmware/' /etc/apt/sources.list; \
    fi; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends \
      ca-certificates curl python3 build-essential cmake pkg-config \
      ffmpeg libva2 libva-drm2 vainfo; \
    if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
      apt-get install -y -qq --no-install-recommends intel-media-va-driver-non-free; \
    fi; \
    rm -rf /var/lib/apt/lists/*

# ── deps: full install (dev deps) — feeds the dist builds below ─────────────
# `--frozen-lockfile` requires every workspace member's package.json present,
# so the globs enumerate every member (top-level, nested packages/*/packages/*,
# homelab/src/*, the desktop src-tauri crate, and the `scripts` dir).
FROM base-build AS deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/streambot'

# ── build: the two dist-resolving fork deps ─────────────────────────────────
# discord-video-stream and discord-stream-lifecycle both resolve their package
# entry to a gitignored `dist/`; streambot imports them, so compile both
# (consumers crash at startup with `Cannot find module` otherwise).
FROM deps AS build
COPY --parents \
  tsconfig.base.json \
  packages/streambot \
  packages/discord-stream-lifecycle \
  packages/discord-video-stream \
  ./
RUN cd packages/discord-stream-lifecycle && bun run build \
 && cd /app/packages/discord-video-stream && bun run build

# ── prod-deps: production-only node_modules, cached on manifests ────────────
# Inherits base-build: the native trustedDependencies postinstalls run here
# too and need the same toolchain.
FROM base-build AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/streambot'

# ── runtime: ffmpeg/VAAPI stack + COPY-only app layers — no compilers ───────
FROM base AS runtime
RUN set -e; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's/^Components: main.*/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources; \
    fi; \
    if [ -f /etc/apt/sources.list ]; then \
      sed -i 's/ main$/ main contrib non-free non-free-firmware/' /etc/apt/sources.list; \
    fi; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends \
      ca-certificates curl python3 \
      ffmpeg libva2 libva-drm2 vainfo; \
    if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
      apt-get install -y -qq --no-install-recommends intel-media-va-driver-non-free; \
    fi; \
    rm -rf /var/lib/apt/lists/*

# yt-dlp standalone binary from the release CDN (rate-limit-proof, SHA-verified),
# installed at the config-default path /usr/local/bin/yt-dlp. Per-arch asset,
# pinned checksum, retries. Independent of the app layers below.
# renovate: datasource=github-releases depName=yt-dlp/yt-dlp
ARG YT_DLP_VERSION=2026.07.04
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    if [ "$arch" = "amd64" ]; then asset=yt-dlp_linux; \
    elif [ "$arch" = "arm64" ]; then asset=yt-dlp_linux_aarch64; \
    else echo "unsupported architecture: $arch" >&2; exit 1; fi; \
    base="https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}"; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$base/$asset" -o "/tmp/$asset"; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$base/SHA2-256SUMS" -o /tmp/SHA2-256SUMS; \
    (cd /tmp && sha256sum -c --ignore-missing SHA2-256SUMS); \
    install -D -m 0755 "/tmp/$asset" /usr/local/bin/yt-dlp; \
    rm -f "/tmp/$asset" /tmp/SHA2-256SUMS

# Production node_modules + workspace manifests. The isolated-linker tree uses
# relative symlinks (store at node_modules/.bun), so copying the whole install
# root between same-rooted stages is safe. Kept BEFORE the source COPY so a
# source edit doesn't re-push this layer.
COPY --from=prod-deps /app/ /app/

# Scoped source closure + the built dists from the build stage.
COPY --parents \
  tsconfig.base.json \
  packages/streambot \
  packages/discord-stream-lifecycle \
  packages/discord-video-stream \
  ./
COPY --from=build /app/packages/discord-stream-lifecycle/dist packages/discord-stream-lifecycle/dist
COPY --from=build /app/packages/discord-video-stream/dist packages/discord-video-stream/dist

ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# Run from the package dir so Bun resolves this package's tsconfig / imports map.
WORKDIR /app/packages/streambot
CMD ["bun", "src/index.ts"]

FROM runtime AS smoke
# The smoke harness ships in CI context only — the scoped source COPY
# excludes .buildkite, so stage it here (never in the pushed image stage).
COPY .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts
ARG SMOKE_TARGET=streambot
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# Smoke runs as the non-root deploy uid (1000, the app deployment convention),
# never root: a root smoke cannot see uid-1000-only failures — the Prisma
# engines EACCES crash-loop (#1682) passed root smoke and died in prod. HOME
# points at /tmp so any tool cache has a writable target.
USER 1000:1000
ENV HOME=/tmp
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts

FROM runtime AS image
