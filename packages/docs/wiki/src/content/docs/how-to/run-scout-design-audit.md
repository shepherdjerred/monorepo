---
title: Run the Scout design audit
description: Run the deterministic Scout browser audit locally or reproduce its scheduled Buildkite check.
sidebar:
  order: 14
---

Run the Scout design audit with local servers and its deterministic database
fixture; CI uses the same boot path for repeatable browser checks.

The complete flag, port, and path reference is in [Scout design-audit
reference](/reference/scout-design-audit/).

## 1. Run the complete local audit

From the repository root, run the same 616-case matrix as the scheduled check:

```bash
ASTRO_DEV_BACKGROUND=0 CI=true TZ=UTC \
SCOUT_DESIGN_AUDIT_MODE=nightly \
SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS=true \
bun --no-install run --cwd packages/scout-for-lol/packages/design-audit test:e2e
```

The exact route, theme, viewport, and browser counts are in the
[design-audit reference](/reference/scout-design-audit/).

## 2. Reproduce the scheduled Buildkite boundary

The `monorepo-test-reporting` pipeline runs the audit daily at 03:00 PT. Its
`scout-design-audit` step uses the pinned Playwright image and remains a soft
failure while main establishes a stable passing history. The command is defined
in [`reporting-pipeline.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/reporting-pipeline.yml).

Set `SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS=true` to use the deterministic local
fixture. External audit URLs are only needed when that flag is omitted.

## 3. Know what local boot does

The Playwright configuration starts the services and uses the endpoints listed
in the [Scout design-audit reference](/reference/scout-design-audit/).

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
ASTRO_DEV_BACKGROUND=0 CI=true TZ=UTC \
SCOUT_DESIGN_AUDIT_MODE=nightly \
SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS=true \
bun --no-install run --cwd packages/scout-for-lol/packages/design-audit \
  test:e2e -- --project=chromium-mobile --update-snapshots
```

Review the changed files before committing them. A normal audit run must not
use `--update-snapshots`.

## 5. Narrow a failing check

Use Playwright's project and grep filters to reproduce one route or viewport:

```bash
ASTRO_DEV_BACKGROUND=0 CI=true TZ=UTC \
SCOUT_DESIGN_AUDIT_MODE=nightly \
SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS=true \
bun --no-install run --cwd packages/scout-for-lol/packages/design-audit \
  test:e2e -- --project=chromium-mobile --grep 'app/report-new.*classic-light' \
  --workers=1
```

Keep the audit running against the local boot path while debugging. It is the
same fixture and service boundary that CI exercises.

## Related

- [Why the CI pipeline has so many steps](/explanation/ci-pipeline-shape/)
