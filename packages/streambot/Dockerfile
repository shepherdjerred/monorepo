# syntax=docker/dockerfile:1-labs@sha256:63e440b412b6acba117974e793b7e7f702e58ee65e044bdff1b8d388ee0d853b
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
# identically. npm is also installed because prebuild-install uses it for the
# source-build fallback when a native prebuild is unavailable. The runtime
# stage keeps only the ffmpeg/VAAPI runtime stack — no compilers. Dev
# dependencies and the rest of the monorepo source never reach the final
# image, and the source layer only invalidates when a closure package changes —
# not on every repo commit.
FROM oven/bun:1.4.0@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 AS base
WORKDIR /app

# ── base-build: runtime libs + build toolchain for native postinstalls ──────
# Mirrors the old single-stage apt layer exactly (ffmpeg + VAAPI + compilers)
# so the node-datachannel / node-av native builds see the same environment.
FROM base AS base-build
# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Reproducibility would need a snapshot archive, not
# a version pin. Acknowledged per-site so a NEW unpinned install still fails.
# hadolint ignore=DL3008
RUN set -e; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's/^Components: main.*/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources; \
    fi; \
    if [ -f /etc/apt/sources.list ]; then \
      sed -i 's/ main$/ main contrib non-free non-free-firmware/' /etc/apt/sources.list; \
    fi; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends \
      ca-certificates curl npm python3 build-essential cmake pkg-config \
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
COPY --exclude=packages/streambot/test/fixtures/voice-corpus --parents \
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

# ── voice-models: pinned, checksum-verified local wake + VAD assets ─────────
# Models are fetched only while building the immutable image. Runtime startup
# validates these files and never reaches the network for local activation.
FROM base-build AS voice-models
# Fail-fast shell: the checksum verification pipes echo into sha256sum, and a
# failed producer must fail the build rather than be masked by the consumer.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ARG SHERPA_KWS_ARCHIVE_SHA256=f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a
ARG SILERO_VAD_SHA256=9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6
RUN set -e; \
    mkdir -p /opt/streambot/voice; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
      https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2 \
      -o /tmp/kws.tar.bz2; \
    echo "${SHERPA_KWS_ARCHIVE_SHA256}  /tmp/kws.tar.bz2" | sha256sum -c -; \
    tar -xjf /tmp/kws.tar.bz2 -C /opt/streambot/voice --strip-components=1; \
    rm -f /tmp/kws.tar.bz2 \
      /opt/streambot/voice/encoder-epoch-12-avg-2-chunk-16-left-64.onnx \
      /opt/streambot/voice/decoder-epoch-12-avg-2-chunk-16-left-64.onnx \
      /opt/streambot/voice/joiner-epoch-12-avg-2-chunk-16-left-64.onnx \
      /opt/streambot/voice/keywords.txt \
      /opt/streambot/voice/keywords_raw.txt; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
      https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx \
      -o /opt/streambot/voice/silero_vad.onnx; \
    echo "${SILERO_VAD_SHA256}  /opt/streambot/voice/silero_vad.onnx" | sha256sum -c -
COPY packages/streambot/assets/voice/ /opt/streambot/voice/

# Small local-output target used by the macOS voice probe preparation command.
FROM scratch AS voice-model-export
COPY --from=voice-models /opt/streambot/voice/ /

# ── runtime: ffmpeg/VAAPI stack + COPY-only app layers — no compilers ───────
FROM base AS runtime
# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Reproducibility would need a snapshot archive, not
# a version pin. Acknowledged per-site so a NEW unpinned install still fails.
# hadolint ignore=DL3008
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

# Scoped source closure + the built dists from the build stage. The canonical
# evaluation corpus is intentionally excluded from production layers.
# config/feature-flags export straight from `src/*.ts` and the isolated linker
# installs them as symlinks into these directories, so their source has to be
# present or the bot dies at boot with "Cannot find module".
COPY --exclude=packages/streambot/test/fixtures/voice-corpus --parents \
  tsconfig.base.json \
  packages/streambot \
  packages/discord-stream-lifecycle \
  packages/discord-video-stream \
  packages/config \
  packages/feature-flags \
  ./
COPY --from=build /app/packages/discord-stream-lifecycle/dist packages/discord-stream-lifecycle/dist
COPY --from=build /app/packages/discord-video-stream/dist packages/discord-video-stream/dist
COPY --from=voice-models /opt/streambot/voice /opt/streambot/voice

ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# Run from the package dir so Bun resolves this package's tsconfig / imports map.
WORKDIR /app/packages/streambot
CMD ["bun", "src/index.ts"]

FROM runtime AS voice-smoke
# Model loading runs as the non-root deploy uid. The final image copies its
# sentinel, making this stage a required dependency of every production build.
USER 1000:1000
ENV HOME=/tmp
RUN VOICE_ASSISTANT_ENABLED=true \
    OPENAI_API_KEY=image-smoke-not-used \
    VOICE_ASSETS_DIR=/opt/streambot/voice \
    bun scripts/voice-model-smoke.ts \
    && touch /tmp/voice-model-smoke-passed

FROM runtime AS smoke
# The general app smoke harness ships in CI context only and never reaches the
# pushed image. Restore the full development dependency tree only in this stage
# because the integration suite runs Vitest, while the runtime image stays
# production-only. Depend on voice-smoke so explicit smoke builds prove both.
COPY --from=deps /app/ /app/
COPY vitest.config.ts /app/vitest.config.ts
COPY --from=voice-smoke /tmp/voice-model-smoke-passed /tmp/voice-model-smoke-passed
COPY .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts
COPY .buildkite/scripts/smoke-app-configs.ts /app/.buildkite/scripts/smoke-app-configs.ts
ARG SMOKE_TARGET=streambot
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
USER 1000:1000
ENV HOME=/tmp
# The real-ffmpeg integration suite belongs to this stage and only this stage.
# It needs the runtime rootfs (ffmpeg + libass + zimg + fonts) AND a Vitest
# runner, and the published image deliberately carries no development
# dependencies — so it cannot run from the shared harness, which also executes
# against the pushed digest (.buildkite/application-image-smoke.Dockerfile).
RUN mkdir -p /tmp/videos \
    && cd /app/packages/streambot \
    && bun run test:integration
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts

FROM runtime AS image
# Corpus evaluation is deliberately NOT a build dependency: it is a multi-hour acceptance
# measurement, run by an operator inside this image (see the voice wiki reference) with its
# report committed to voice-training/reports/. The build gate is the two-runtime smoke above.
COPY --from=voice-smoke /tmp/voice-model-smoke-passed /opt/streambot/voice/.image-smoke-passed
