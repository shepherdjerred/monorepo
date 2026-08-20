---
title: Run the Scout design audit
description: Run the deterministic Scout browser audit locally, in the pull-request lane, or across the nightly browser matrix.
sidebar:
  order: 14
---

Run the Scout design audit with local servers and its deterministic database
fixture; CI uses the same boot path for repeatable browser checks.

## 1. Run the pull-request audit

From the repository root, run the Chromium audit used by pull-request CI:

```bash
ASTRO_DEV_BACKGROUND=false CI=true TZ=UTC \
SCOUT_DESIGN_AUDIT_MODE=pr \
SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS=true \
bun --no-install run --cwd packages/scout-for-lol/packages/design-audit test:e2e
```

The pull-request mode checks the public site, docs site, and app across the
committed viewport set. The Buildkite command is defined in
[`pipeline.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml).

## 2. Run the nightly browser matrix

Use nightly mode when you need Firefox and WebKit coverage in addition to
Chromium:

```bash
ASTRO_DEV_BACKGROUND=false CI=true TZ=UTC \
SCOUT_DESIGN_AUDIT_MODE=nightly \
SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS=true \
bun --no-install run --cwd packages/scout-for-lol/packages/design-audit test:e2e
```

Main CI guards this wider matrix to the default branch. Both modes select local
servers when `SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS=true`; external audit URLs
are only needed when that flag is omitted.

## 3. Know what local boot does

The Playwright configuration starts these processes:

| Service   | Local URL                     | Role                  |
| --------- | ----------------------------- | --------------------- |
| Marketing | `http://127.0.0.1:4321/`      | Public Scout routes   |
| Docs      | `http://127.0.0.1:4322/docs/` | Scout documentation   |
| Backend   | `http://127.0.0.1:3000/trpc/` | Dev-login API         |
| App       | `http://localhost:5180/app/`  | Scout web application |

The local boot path runs Prisma migrations and generation, then seeds the
stable design-audit fixture through
`packages/scout-for-lol/packages/backend/scripts/seed-design-audit.ts`. It
disables background jobs and the Discord gateway, so the audit needs no Discord
or production API credentials. The boot implementation is
`packages/scout-for-lol/scripts/dev-web.ts`, and the browser projects are
defined in `packages/scout-for-lol/packages/design-audit/playwright.config.ts`.

## 4. Update snapshots deliberately

Snapshots are captured in UTC so local timezone differences do not change the
goldens. After an intentional visual change, update only the required project:

```bash
ASTRO_DEV_BACKGROUND=false CI=true TZ=UTC \
SCOUT_DESIGN_AUDIT_MODE=pr \
SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS=true \
bun --no-install run --cwd packages/scout-for-lol/packages/design-audit \
  test:e2e -- --project=chromium-mobile --update-snapshots
```

Review the changed files before committing them. A normal audit run must not
use `--update-snapshots`.

## 5. Narrow a failing check

Use Playwright's project and grep filters to reproduce one route or viewport:

```bash
ASTRO_DEV_BACKGROUND=false CI=true TZ=UTC \
SCOUT_DESIGN_AUDIT_MODE=pr \
SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS=true \
bun --no-install run --cwd packages/scout-for-lol/packages/design-audit \
  test:e2e -- --project=chromium-mobile --grep 'app/report-new.*modern-dark' \
  --workers=1
```

Keep the audit running against the local boot path while debugging. It is the
same fixture and service boundary that CI exercises.

## Related

- [Why the CI pipeline has so many steps](/explanation/ci-pipeline-shape/)
