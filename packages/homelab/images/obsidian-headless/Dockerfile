# Obsidian Headless CLI for vault sync.
#
# Translated from the old Dagger recipe (buildObsidianHeadlessImageHelper).
# Deliberately Node, NOT Bun: obsidian-headless depends on better-sqlite3, a
# native Node addon that Bun does not support. python3 + build-essential are
# needed to compile better-sqlite3's native bindings during `npm install`.
#
# Pinned to a specific obsidian-headless npm version so a bump is an explicit,
# reviewable change; the pin is also baked as OBSIDIAN_HEADLESS_EXPECTED_VERSION
# so the smoke test can assert the installed version matches.

# renovate: datasource=docker depName=node
FROM node:24-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 build-essential \
  && rm -rf /var/lib/apt/lists/*

# renovate: datasource=npm depName=obsidian-headless
ARG OBSIDIAN_HEADLESS_VERSION=0.0.10
ENV OBSIDIAN_HEADLESS_EXPECTED_VERSION=${OBSIDIAN_HEADLESS_VERSION}

RUN npm install -g "obsidian-headless@${OBSIDIAN_HEADLESS_VERSION}" \
  && node --version \
  && which ob \
  && mkdir -p /vault

LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

ENTRYPOINT ["/bin/sh", "-c"]

FROM runtime AS smoke
RUN ob --help \
  && actual="$(ob --version)" \
  && test "$actual" = "$OBSIDIAN_HEADLESS_EXPECTED_VERSION" \
  && cd "$(npm root -g)/obsidian-headless" \
  && node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.exec('CREATE TABLE t (x INT)'); db.prepare('INSERT INTO t VALUES (?)').run(42); if (db.prepare('SELECT x FROM t').get().x !== 42) throw new Error('better-sqlite3 round-trip failed');"

FROM runtime AS image
