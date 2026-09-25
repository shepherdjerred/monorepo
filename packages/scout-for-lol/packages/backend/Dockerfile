# syntax=docker/dockerfile:1-labs@sha256:63e440b412b6acba117974e793b7e7f702e58ee65e044bdff1b8d388ee0d853b
# scout-for-lol backend image. Build context is the REPO ROOT (single Bun
# workspace, one root bun.lock, isolated linker, workspace:* deps). Built via
# `bun run docker:build` in this package (which passes `-f Dockerfile ../../../..`).
#
# Multi-stage: deps does a full (dev-inclusive) install to feed the in-image
# llm-models build + prisma generate; prod-deps installs the production-only
# closure; runtime COPYs the prod tree, the scoped source closure, and the
# built artifacts — it never runs `bun install`. Dev dependencies and the rest
# of the monorepo source never reach the final image, and the source layer only
# invalidates when a closure package changes — not on every repo commit.
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS base
WORKDIR /app

# ── deps: full install (dev deps) — feeds the artifact builds below ─────────
# `--frozen-lockfile` requires every workspace member's package.json present,
# so the globs enumerate every member (top-level, nested packages/*/packages/*,
# homelab/src/*, and the `scripts` dir).
FROM base AS deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  ./
RUN bun install --frozen-lockfile --filter '@scout-for-lol/backend'

# ── build: gitignored artifacts (llm-models dist + Prisma client) ───────────
FROM deps AS build
COPY --parents \
  tsconfig.base.json \
  packages/scout-for-lol/tsconfig.base.json \
  packages/glitter-context \
  packages/llm-models \
  packages/scout-for-lol/packages/domain \
  packages/scout-for-lol/packages/data \
  packages/scout-for-lol/packages/backend \
  ./
# @shepherdjerred/glitter-context also publishes a gitignored `dist/`.
RUN cd packages/glitter-context && bun run build
# @shepherdjerred/llm-models' package `main`/`types` resolve to a gitignored
# `dist/`, so any consumer (scout's data package imports it) crashes at
# startup with `Cannot find module '@shepherdjerred/llm-models'` unless the
# catalog is compiled first.
RUN cd packages/llm-models && bun run build
# Generate the Prisma client for the backend (output is gitignored, so it must
# be produced in-image). Engines download at build time — that's expected.
# Only `prisma generate` here — the package's full `generate` script also runs
# brand-types + prettier + a test-template DB build, which are dev/test-only.
RUN cd packages/scout-for-lol/packages/backend && bun x --trust prisma generate

# ── prod-deps: production-only node_modules, cached on manifests ────────────
FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter '@scout-for-lol/backend'

# ── voice-models: pinned, checksum-verified local wake + VAD assets ─────────
# Fetched only while building the immutable image; runtime startup validates
# these files and never reaches the network for local activation. The upstream
# archives are byte-identical to the ones streambot pins, so the SHA-256 values
# are deliberately the same two constants — if one image's download is
# tampered with or silently re-cut, both builds fail identically.
#
# The download supplies the sherpa keyword-spotting trio, tokens/bpe, and the
# VAD; `assets/voice/` supplies the trained hey-scout classifier, its keyword
# file, the wake-verifier manifest, and the smoke/feedback WAVs. Together they
# are exactly `scoutVoiceAssetManifest` plus `VOICE_FEEDBACK_CLIP_FILES`
# (src/voice-assistant/constants.ts) — the packaging contract that file's
# comment calls "M5's Docker voice stage".
FROM base AS voice-models
# Scout's `base` is a bare bun image with no TLS roots or curl, unlike
# streambot's compiler-bearing `base-build`. Install only what the fetch needs.
# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Reproducibility would need a snapshot archive, not
# a version pin. Acknowledged per-site so a NEW unpinned install still fails.
# hadolint ignore=DL3008
RUN apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends ca-certificates curl bzip2 \
  && rm -rf /var/lib/apt/lists/*
# Fail-fast shell: the checksum verification pipes echo into sha256sum, and a
# failed producer must fail the build rather than be masked by the consumer.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ARG SHERPA_KWS_ARCHIVE_SHA256=f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a
ARG SILERO_VAD_SHA256=9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6
RUN set -e; \
    mkdir -p /opt/scout/voice; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
      https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2 \
      -o /tmp/kws.tar.bz2; \
    echo "${SHERPA_KWS_ARCHIVE_SHA256}  /tmp/kws.tar.bz2" | sha256sum -c -; \
    tar -xjf /tmp/kws.tar.bz2 -C /opt/scout/voice --strip-components=1; \
    rm -f /tmp/kws.tar.bz2 \
      /opt/scout/voice/encoder-epoch-12-avg-2-chunk-16-left-64.onnx \
      /opt/scout/voice/decoder-epoch-12-avg-2-chunk-16-left-64.onnx \
      /opt/scout/voice/joiner-epoch-12-avg-2-chunk-16-left-64.onnx \
      /opt/scout/voice/keywords.txt \
      /opt/scout/voice/keywords_raw.txt; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
      https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx \
      -o /opt/scout/voice/silero_vad.onnx; \
    echo "${SILERO_VAD_SHA256}  /opt/scout/voice/silero_vad.onnx" | sha256sum -c -
COPY packages/scout-for-lol/packages/backend/assets/voice/ /opt/scout/voice/

# Local-output target for the operator acceptance flow: exports the exact
# assembled asset set so `voice-training/` work no longer hand-copies streambot's
# export and overlays Scout's files by hand.
FROM scratch AS voice-model-export
COPY --from=voice-models /opt/scout/voice/ /

# ── runtime: COPY-only — no install, no build tooling, no network ───────────
FROM base AS runtime
# The isolated-linker tree uses relative symlinks (store at node_modules/.bun),
# so copying the whole install root between same-rooted stages is safe. Kept
# BEFORE the source COPY so a source edit doesn't re-push this layer.
COPY --from=prod-deps /app/ /app/
# Scoped source closure. Report Satori imports resolve through the shared
# design-system package, which also owns the exact font and rank-crest bytes.
# `@shepherdjerred/config`, `@shepherdjerred/feature-flags`, and
# `@shepherdjerred/voice-assistant` are source-only (no build step, exports
# resolve straight to `src/*`), so their source must be physically present
# here too, not just linked from node_modules — `discord/bootstrap.ts` imports
# the voice-assistant manager unconditionally (voice's own enabled gate is
# evaluated only after that import resolves), so this is required in every
# environment, not only a voice-enabled one. The trained wake-word assets
# themselves are baked at /opt/scout/voice by the voice-models stage below.
COPY --parents \
  tsconfig.base.json \
  packages/scout-for-lol/tsconfig.base.json \
  packages/scout-for-lol/packages/backend \
  packages/scout-for-lol/packages/data \
  packages/scout-for-lol/packages/design-system \
  packages/scout-for-lol/packages/domain \
  packages/scout-for-lol/packages/report \
  packages/scout-for-lol/packages/temporal \
  packages/config \
  packages/feature-flags \
  packages/llm-models \
  packages/llm-observability \
  packages/s3-signed-request \
  packages/llm-runtime \
  packages/temporal-observability \
  packages/voice-assistant \
  ./
# Bake the Prisma engines into the production tree. prod-deps installs
# without lifecycle scripts, so @prisma/engines ships empty and the CLI
# downloads engines on FIRST USE — but the pod (and the non-root smoke) runs
# as uid 1000 over this root-owned node_modules, so the startup
# `prisma migrate deploy` died with "Can't write to …@prisma+engines…".
# Running generate here (as root, schema present from the source COPY above)
# fetches them at build time; uid 1000 then only reads them at runtime.
# Mirrors the discord-plays-mario-kart runtime fix (2.0.0-6322 crash-loop).
RUN cd packages/scout-for-lol/packages/backend && bun x --trust prisma generate
# Built artifacts from the build stage.
COPY --from=build /app/packages/glitter-context/dist packages/glitter-context/dist
COPY --from=build /app/packages/llm-models/dist packages/llm-models/dist
COPY --from=build /app/packages/scout-for-lol/packages/backend/generated packages/scout-for-lol/packages/backend/generated
# Pinned voice assets. Present in every image, loaded only when
# VOICE_ASSISTANT_ENABLED is set — baking them unconditionally keeps the
# published digest identical between a voice-enabled and voice-disabled
# deployment, so enabling voice is purely a Deployment change and never needs a
# different image.
COPY --from=voice-models /opt/scout/voice /opt/scout/voice

ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# scout reads VERSION/GIT_SHA at boot (src/configuration.ts requires VERSION).
# Declared as build args so CI can bake the real build number + commit SHA
# (`--build-arg VERSION=… --build-arg GIT_SHA=…`); the `dev`/`unknown` defaults
# keep a plain `docker run` bootable.
ARG VERSION=dev
ARG GIT_SHA=unknown
# Contract-source hash (packages/scout-for-lol/scripts/contract-hash.ts),
# served by /api/version so the SPA can detect contract skew.
ARG CONTRACT_HASH=dev
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV CONTRACT_HASH=${CONTRACT_HASH}

# scout serves an HTTP health/metrics server on PORT (default 3000).
EXPOSE 3000

WORKDIR /app/packages/scout-for-lol/packages/backend

# Run from source (the backend build bundles with `--external '@duckdb/*'`,
# but the old CI image ran source directly). Boot order is load-bearing:
# migrations create the (empty, on first boot) Postgres schema; the legacy
# importer then copies /data/db.sqlite exactly once (marker-guarded,
# fail-closed — see src/database/legacy-import/run-import.ts); the
# parser-aware ScoutQL migration runs after it because the Report rows it
# rewrites arrive with the import. It rewrites every stored report into v2
# syntax: a SQL migration cannot safely distinguish clause keywords from
# quoted text, and legacy syntax stops running the moment this release lands,
# so it must finish — or fail loudly — before the application accepts
# traffic. `prisma` is a runtime dependency of the backend, so `bun x`
# resolves it from the installed tree without a network fetch.
CMD ["/bin/sh", "-c", "bun x prisma migrate deploy && bun run scripts/import-legacy-sqlite.ts && bun run scripts/scoutql/migrate-scoutql-v2.ts --database \"$DATABASE_URL\" --fix && bun run src/index.ts"]

FROM runtime AS voice-smoke
# Model loading runs as the non-root deploy uid, never root: the published image
# runs as 1000 over a root-owned tree, and a root-only smoke would miss exactly
# that class of failure. The final image copies this stage's sentinel, which is
# what makes the gate mandatory rather than advisory — an image whose baked
# assets fail SHA verification or cannot load under either keyword runtime
# cannot be built, let alone pushed.
USER 1000:1000
ENV HOME=/tmp
RUN VOICE_ASSETS_DIR=/opt/scout/voice \
    bun scripts/voice-model-smoke.ts \
    && touch /tmp/voice-model-smoke-passed

FROM runtime AS smoke
# The smoke boots the backend against a throwaway local Postgres (the app no
# longer speaks SQLite). Debian bookworm's postgresql (v15) is fine here: the
# baseline migration is plain DDL, and PG16 parity is covered by the test
# suite and beta. Installed in the smoke stage ONLY — the pushed `image`
# stage inherits from `runtime` and stays byte-identical.
# Numeric uid (DL3066) — root here is the smoke stage only; the stage drops
# back to the deploy uid below.
USER 0
# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Reproducibility would need a snapshot archive, not
# a version pin. Acknowledged per-site so a NEW unpinned install still fails.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends postgresql postgresql-client && rm -rf /var/lib/apt/lists/*
# The smoke harness ships in CI context only — the scoped source COPY
# excludes .buildkite, so stage it here (never in the pushed image stage).
# Depend on voice-smoke so an explicit `--target smoke` build proves both.
COPY --from=voice-smoke /tmp/voice-model-smoke-passed /tmp/voice-model-smoke-passed
COPY .buildkite/scripts/images/smoke-app-in-image.ts /app/.buildkite/scripts/images/smoke-app-in-image.ts
COPY .buildkite/scripts/images/smoke-app-configs.ts /app/.buildkite/scripts/images/smoke-app-configs.ts
ARG SMOKE_TARGET=scout-for-lol
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# Smoke runs as the non-root deploy uid (1000, the app deployment convention),
# never root: a root smoke cannot see uid-1000-only failures — the Prisma
# engines EACCES crash-loop (#1682) passed root smoke and died in prod. HOME
# points at /tmp so any tool cache has a writable target.
USER 1000:1000
ENV HOME=/tmp
# This stage needs only its local Unix-socket Postgres. An isolated network
# namespace prevents its fixed HTTP health port from colliding with another
# concurrent Scout smoke on the shared remote BuildKit workers.
RUN --network=none bun /app/.buildkite/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
# Corpus evaluation is deliberately NOT a build dependency: it is a multi-hour
# acceptance measurement run by an operator, with its report committed under
# voice-training/reports/. The build gate is the two-runtime smoke above.
COPY --from=voice-smoke /tmp/voice-model-smoke-passed /opt/scout/voice/.image-smoke-passed
