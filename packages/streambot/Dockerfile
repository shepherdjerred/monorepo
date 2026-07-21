# syntax=docker/dockerfile:1.7-labs@sha256:b99fecfe00268a8b556fad7d9c37ee25d716ae08a5d7320e6d51c4dd83246894
# streambot image. Build context is the REPO ROOT (single Bun workspace, one
# root bun.lock, isolated linker). Built via `bun run docker:build` in this
# package (which passes `-f Dockerfile ../..`).
#
# streambot shells out to ffmpeg (transcode) and a system yt-dlp
# (/usr/local/bin/yt-dlp, config default). Both are installed below, mirroring
# the old Dagger `withStreambotRuntime`. The Intel VAAPI iHD hardware-encode
# driver (intel-media-va-driver-non-free) is x86-only and installed amd64-only;
# arm64 builds fall back to software encoding.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
WORKDIR /app

# --- Runtime binaries: ffmpeg + VAAPI libs, then the SHA-verified yt-dlp. ---
# Enable Debian contrib/non-free (where the Intel iHD driver lives), install
# ffmpeg + VAAPI userspace, and the amd64-only non-free iHD driver.
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

# yt-dlp standalone binary from the release CDN (rate-limit-proof, SHA-verified),
# installed at the config-default path /usr/local/bin/yt-dlp. Mirrors the old
# installYtDlp helper: per-arch asset, SHA2-256SUMS check, retries.
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    if [ "$arch" = "amd64" ]; then asset=yt-dlp_linux; \
    elif [ "$arch" = "arm64" ]; then asset=yt-dlp_linux_aarch64; \
    else echo "unsupported architecture: $arch" >&2; exit 1; fi; \
    base=https://github.com/yt-dlp/yt-dlp/releases/latest/download; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$base/$asset" -o "/tmp/$asset"; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$base/SHA2-256SUMS" -o /tmp/SHA2-256SUMS; \
    cd /tmp; \
    grep " $asset$" SHA2-256SUMS > "$asset.sha256"; \
    sha256sum -c "$asset.sha256"; \
    install -D -m 0755 "/tmp/$asset" /usr/local/bin/yt-dlp; \
    rm -f "/tmp/$asset" /tmp/SHA2-256SUMS "/tmp/$asset.sha256"

# --- Workspace install + build the two dist-resolving fork deps. ---
# Manifests-only install layer: install streambot and its complete workspace
# dependency closure, including the two dist-producing streaming packages built
# below. This avoids unrelated applications and only invalidates when a
# manifest/lockfile/patch changes.
# `--frozen-lockfile` requires every workspace member's package.json present, so
# the globs enumerate every member (top-level, nested packages/*/packages/*,
# homelab/src/*, the desktop src-tauri crate, and the `scripts` dir).
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/streambot'

# Now the sources. node_modules is excluded from context by .dockerignore, so
# this does not clobber the installed tree.
COPY . .

# discord-video-stream and discord-stream-lifecycle both resolve their package
# entry to a gitignored `dist/`; streambot imports them, so compile both before
# boot (mirrors the old withBuiltDiscordStreamLifecycle + shared-build step).
# node-datachannel / node-av native deps are already built by `bun install`
# (trustedDependencies) thanks to the build tooling installed above.
RUN cd packages/discord-stream-lifecycle && bun run build \
 && cd /app/packages/discord-video-stream && bun run build

ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# Run from the package dir so Bun resolves this package's tsconfig / imports map.
WORKDIR /app/packages/streambot
CMD ["bun", "src/index.ts"]
