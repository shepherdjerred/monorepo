# syntax=docker/dockerfile:1-labs@sha256:63e440b412b6acba117974e793b7e7f702e58ee65e044bdff1b8d388ee0d853b
# birmel image. Build context is the REPO ROOT (single Bun workspace, one root
# bun.lock, isolated linker). Built via `bun run docker:build` in this package
# (which passes `-f Dockerfile ../..`).
#
# Multi-stage: deps does a full (dev-inclusive) install to feed the in-image
# prisma generate; prod-deps installs the production-only closure; runtime
# COPYs the prod tree, the scoped source closure, and the generated Prisma
# client — it never runs `bun install`. Dev dependencies and the rest of the
# monorepo source never reach the final image, and the source layer only
# invalidates when a closure package changes — not on every repo commit.
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS base
WORKDIR /app

# ── deps: full install (dev deps) — feeds the prisma generate below ─────────
# `--frozen-lockfile` requires every workspace member's package.json present,
# so the globs enumerate every member (top-level, nested packages/*/packages/*,
# homelab/src/*, the desktop src-tauri crate, and the `scripts` dir).
FROM base AS deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/birmel'

# ── build: generate the Prisma client (output is gitignored, produced here) ──
FROM deps AS build
COPY --parents \
  tsconfig.base.json \
  packages/birmel \
  packages/config \
  packages/feature-flags \
  packages/glitter-context \
  packages/llm-models \
  ./
RUN cd packages/glitter-context && bun run build
# llm-models' package `main`/`exports` resolve to a gitignored `dist/`, so the
# llm-runtime closure Birmel imports at startup crashes with `Cannot find
# module '@shepherdjerred/llm-models'` unless the catalog is compiled first.
RUN cd packages/llm-models && bun run build
RUN cd packages/birmel && bun run generate

# ── prod-deps: production-only node_modules, cached on manifests ────────────
FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/birmel'

# ── runtime: sandbox runtimes + COPY-only app layers — no build tooling ─────
FROM base AS runtime

# Python, libkeyutils, and util-linux support the credential-free run-code sidecar;
# util-linux-extra supplies the seccomp filter compiler. Tini and uid-scoped
# cleanup remain defense in depth around the no-descendants process limit.
# iptables is used by init containers to enforce browser and snippet egress.
# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Acknowledged per-site so a NEW unpinned install
# still fails.
# hadolint ignore=DL3008
RUN set -e; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends iptables libkeyutils1 python3 tini util-linux util-linux-extra; \
    rm -rf /var/lib/apt/lists/*; \
    iptables --version; enosys --version; prlimit --version; setpriv --version; tini --version; python3 --version; \
    enosys --dump=/usr/local/share/birmel-persistence.seccomp \
      -s mq_open:EPERM -s mq_unlink:EPERM -s mq_timedsend:EPERM \
      -s mq_timedreceive:EPERM -s mq_notify:EPERM -s mq_getsetattr:EPERM \
      -s msgget:EPERM -s msgsnd:EPERM -s msgrcv:EPERM -s msgctl:EPERM \
      -s semget:EPERM -s semop:EPERM -s semtimedop:EPERM -s semctl:EPERM \
      -s shmget:EPERM -s shmat:EPERM -s shmdt:EPERM -s shmctl:EPERM \
      -s add_key:EPERM -s request_key:EPERM -s keyctl:EPERM; \
    test -s /usr/local/share/birmel-persistence.seccomp
RUN set -e; \
    check_blocked() { \
      set +e; \
      setpriv --no-new-privs --seccomp-filter=/usr/local/share/birmel-persistence.seccomp -- "$@"; \
      status="$?"; \
      set -e; \
      [ "$status" -eq 1 ]; \
    }; \
    check_blocked ipcmk --queue; \
    check_blocked ipcmk --shmem 4096; \
    check_blocked ipcmk --semaphore 1; \
    setpriv --no-new-privs --seccomp-filter=/usr/local/share/birmel-persistence.seccomp -- \
      python3 -c 'import ctypes, errno, os; library = ctypes.CDLL("librt.so.1", use_errno=True); result = library.mq_open(b"/birmel-build-smoke", os.O_CREAT | os.O_RDWR, 0o600, None); raise SystemExit(0 if result == -1 and ctypes.get_errno() == errno.EPERM else 1)'; \
    setpriv --no-new-privs --seccomp-filter=/usr/local/share/birmel-persistence.seccomp -- \
      python3 -c 'import ctypes, errno; library = ctypes.CDLL("libkeyutils.so.1", use_errno=True); result = library.add_key(b"user", b"birmel-build-smoke", b"persist", 7, -4); raise SystemExit(0 if result == -1 and ctypes.get_errno() == errno.EPERM else 1)'
COPY --chmod=0444 \
  packages/birmel/src/sandbox/limit-bun-processes.ts \
  packages/birmel/src/sandbox/process-limits.ts \
  /usr/local/share/birmel-sandbox/

# Production node_modules + workspace manifests. The isolated-linker tree uses
# relative symlinks (store at node_modules/.bun), so copying the whole install
# root between same-rooted stages is safe. Kept BEFORE the source COPY so a
# source edit doesn't re-push this layer.
COPY --from=prod-deps /app/ /app/

# Scoped source closure + the generated Prisma client from the build stage.
COPY --parents \
  tsconfig.base.json \
  packages/birmel \
  packages/config \
  packages/feature-flags \
  packages/llm-models \
  packages/llm-observability \
  packages/s3-signed-request \
  packages/llm-runtime \
  ./
# Bake Prisma's migration engines into the production dependency tree. Bun's
# production install omits lifecycle scripts, so the CLI otherwise downloads
# engines on first use. Runtime and smoke execute as uid 1000 over root-owned
# node_modules, which correctly prevents that startup write. Generate once as
# root during the image build so migrate deploy is read-only at runtime.
RUN cd packages/birmel && bunx --trust prisma generate
COPY --from=build /app/packages/birmel/generated packages/birmel/generated
COPY --from=build /app/packages/glitter-context/dist packages/glitter-context/dist
COPY --from=build /app/packages/llm-models/dist packages/llm-models/dist

ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
ENV BIRMEL_SCREENSHOTS_DIR=/app/data/screenshots
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# Run from the package dir so Bun resolves this package's tsconfig / imports map
# (the `#generated/*` subpath imports). The entrypoint fingerprints an existing
# unmigrated database, resolves the verified baseline, and runs migrate deploy
# before starting Discord.
WORKDIR /app/packages/birmel
RUN chown -R root:1000 /app && chmod -R o-rwx /app && chmod -R g+rX /app && \
    mkdir -p /app/data/screenshots && chown -R 1000:1000 /app/data && chmod 700 /app/data
USER 1000:1000
CMD ["bun", "scripts/start.ts"]

FROM runtime AS smoke
# The smoke harness ships in CI context only — the scoped source COPY
# excludes .buildkite, so stage it here (never in the pushed image stage).
COPY .buildkite/scripts/images/smoke-app-in-image.ts /app/.buildkite/scripts/images/smoke-app-in-image.ts
COPY .buildkite/scripts/images/smoke-app-configs.ts /app/.buildkite/scripts/images/smoke-app-configs.ts
ARG SMOKE_TARGET=birmel
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# Smoke runs as the non-root deploy uid (1000, the app deployment convention),
# never root: a root smoke cannot see uid-1000-only failures — the Prisma
# engines EACCES crash-loop (#1682) passed root smoke and died in prod. HOME
# points at /tmp so any tool cache has a writable target.
USER 1000:1000
ENV HOME=/tmp
RUN bun /app/.buildkite/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
