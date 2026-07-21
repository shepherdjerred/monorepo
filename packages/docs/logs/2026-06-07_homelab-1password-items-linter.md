---
id: log-2026-06-07-homelab-1password-items-linter
type: log
status: complete
board: false
---

# Homelab 1Password item/field linter

## Context

Homelab references ~52 1Password items via the `OnePasswordItem` CRD and consumes their
fields as Kubernetes secret keys. Nothing verified that those items/fields actually exist —
a typo'd field name, a renamed field, or a missing item only surfaced at deploy time
(operator sync failure or a pod crash). This adds a linter that guarantees every referenced
1Password item and field exists.

## Design

Per an attack-surface concern (no 1Password credentials in CI/pre-commit), the linter is
**fully offline** and validates against a **committed snapshot** of vault structure that
holds **only sha256 hashes** of item ids/titles/field keys — no values, no plaintext names.
Credentials are needed in exactly one place: a local **refresh** command run by the operator.

- **Linter** `src/cdk8s/scripts/check-1password-items.ts` — synthesizes the cdk8s app
  in-memory (`new App()` + `setupCharts` + `chart.toJson()`), collects every `OnePasswordItem`
  reference and every consumed secret field (`secretKeyRef`, volume `secret.items[].key`),
  and checks each against `src/cdk8s/onepassword-vault-snapshot.json`. Exit 0/1/2.
- **Refresher** `src/cdk8s/scripts/snapshot-1password-vault.ts` — the only piece that talks to
  1Password. `op` CLI (default) or 1Password Connect (`OP_CONNECT_TOKEN`+`OP_CONNECT_URL`),
  concurrent + retried. Writes hashes only.
- **Shared lib** `src/cdk8s/scripts/onepassword-lib.ts` — sha256, the operator's
  field-label→secret-key transform (`formatSecretDataName`), and zod schemas.

### Operator transform (the one correctness risk)

Ported faithfully from `1Password/onepassword-operator`
`pkg/kubernetessecrets/kubernetes_secrets_builder.go`: the secret data key is the field
**label** (not id); valid keys (`[-._a-zA-Z0-9]+`, not `.`/`..`) pass through verbatim
(case preserved), otherwise leading/trailing invalid chars are stripped and internal invalid
runs collapse to `-`. Empirically validated against the `streambot-config` item (known keys
`BOT_TOKEN`, `TOKEN`, `GUILD_ID`, …). Field **existence** = label present; the linter does not
check population (values are volatile, never snapshotted). `secretKeyRef` `optional: true` is
exempt from the existence requirement.

### Wiring

- **Pre-commit** — `lefthook.yml` Tier-2 hook `onepassword-items`, glob-scoped to
  `src/cdk8s/src/**/*.ts` + the snapshot, `root: packages/homelab/src/cdk8s/`.
- **Dagger** — `homelabOnePasswordLint` (`.dagger/src/index.ts` + `homelabOnePasswordLintHelper`
  in `.dagger/src/homelab.ts`), reuses the cdk8s synth container (`bunBaseContainer`), no secrets.
- **Buildkite** — `onePasswordItemsStep()` in `scripts/ci/src/steps/helm.ts` (key
  `homelab-1password-items`), registered in `pipeline-builder.ts` alongside `cdk8sSynthStep`
  under `homelabChanged`; blocking (no `soft_fail`). Test added in `pipeline-builder.test.ts`.

The import uses the existing `@shepherdjerred/homelab/cdk8s/*` tsconfig-paths alias (resolved
by bun) rather than a `../src` parent import, so no eslint override is needed.

## Findings surfaced by the linter (real, pre-existing)

Running against the vault revealed genuine discrepancies (not false positives):

- **temporal-worker-1p** references 5 fields that don't exist on the item (`BUILDKITE_API_TOKEN`,
  `VOYAGE_API_KEY`, `PR_REVIEW_EVAL_DATABASE_URL`, `PR_REVIEW_FIXTURES_REPO_URL`,
  `HOMELAB_AUDIT_ARCHIVE_BUCKET`) — but all are `secretKeyRef optional: true`, so the deployment
  tolerates their absence. The linter correctly ignores optional refs.
- **mcp-gateway-credentials** has `FASTMAIL_TOKEN` and `GMAIL_TOKEN` present but **empty-valued**.
  These are **required** (non-optional) refs. The field labels exist, so the existence-based
  linter passes them — but at deploy time the operator skips empty-valued fields, so the
  mcp-gateway pod's required env vars would be missing. Flagged separately for follow-up.

## Verification

- Typecheck + eslint clean for all new/changed TS (homelab cdk8s, `.dagger`, `scripts/ci`).
- `scripts/ci` tests: 226 pass (added an assertion that `homelab-1password-items` appears on
  the homelab-changed pipeline path).
- Linter exercised end-to-end: missing-snapshot → exit 2; live snapshot → catches a fake
  item/field; optional refs ignored.
- Restored `setup.ts` codegen drift (`generated/helm/*.types.ts`, `sjer.red/bun.lock`).

## Session Log — 2026-06-07

### Done

- New: `packages/homelab/src/cdk8s/scripts/{check-1password-items,snapshot-1password-vault,onepassword-lib}.ts`
- New (generated, committed): `packages/homelab/src/cdk8s/onepassword-vault-snapshot.json` (hashes only)
- Wiring: `lefthook.yml`, `.dagger/src/{homelab,index}.ts`, `scripts/ci/src/steps/helm.ts`,
  `scripts/ci/src/pipeline-builder.ts` (+ test)
- Docs: `packages/homelab/AGENTS.md` "1Password Secrets" section; this log

### Remaining

- Decide how to handle the **empty `FASTMAIL_TOKEN`/`GMAIL_TOKEN`** on `mcp-gateway-credentials`
  (populate the tokens in 1Password, or mark the refs `optional`). The linter passes them
  (the field labels exist), but the operator skips empty-valued fields at sync time, so the
  required env vars would be missing at deploy. Tracked as a separate follow-up chip.
- Commit + open PR (not yet done; awaiting user go-ahead).

### Caveats

- The CI gate runs an in-memory cdk8s synth in the Dagger `homelab-one-password-lint` step; it
  reuses `bunBaseContainer` so it needs the cdk8s workspace deps + committed `generated/` (same
  as `homelab-synth`).
- Snapshot staleness is the model's tradeoff (lockfile-style): vault changes require a manual
  refresh + commit. An optional server-side report-only Temporal drift-check could catch this
  without putting credentials in CI (not implemented).

## Addendum — fail on blank required fields (2026-06-07)

Per owner direction ("fail on blank items"), the linter was tightened: field _existence_ alone
is no longer enough for a **required** `secretKeyRef`. The snapshot now records, per item, which
exposed keys are **blank** (empty-valued from every source — still hashes only, no values), and
the linter fails when a required reference points at a blank field (the operator skips empty
fields at sync, so the env var would be missing → `CreateContainerConfigError`). `optional: true`
refs remain exempt. Commit `efa7734bd`.

This flagged **`FASTMAIL_TOKEN`** and **`GMAIL_TOKEN`** on `mcp-gateway-credentials`
(required by mcp-gateway's Fastmail JMAP / Gmail email-reader MCP backends, blank in the vault).

## Addendum — mark GMAIL_TOKEN + FASTMAIL_TOKEN optional (2026-06-13)

Both `GMAIL_TOKEN` (`USER_PASS` env var, Gmail IMAP email-reader MCP) and `FASTMAIL_TOKEN`
(`JMAP_TOKEN` env var, Fastmail JMAP MCP) are blank in the vault because the tokens are pending
population. The correct resolution is to mark both `secretKeyRef` entries `optional: true` — the
same pattern as any pending credential: the pod starts, the specific MCP server fails with a
missing-credential error until the field is populated, then a snapshot refresh + redeploy picks it
up. The `optional: true` flag tells both the linter and the 1Password operator to tolerate a blank
or missing field.

Changed in `packages/homelab/src/cdk8s/src/resources/mcp-gateway/index.ts`:

- `JMAP_TOKEN` / `FASTMAIL_TOKEN` — added `{ optional: true }` second arg to `fromSecretValue`
- `USER_PASS` / `GMAIL_TOKEN` — added `{ optional: true }` second arg to `fromSecretValue`

Linter result after fix: `check-1password-items: OK — 52 item references and 106 field references verified against the vault snapshot (56 items).`

## Session Log — 2026-06-13

### Done

- Investigated the `1password-1password-items` CI failure on PR #1095
- Found `FASTMAIL_TOKEN` (and `GMAIL_TOKEN`) are blank in the committed 1Password snapshot
- Both are for email MCP servers pending credential population — not required for the pod to start
- Marked both `secretKeyRef` entries `optional: true` in `packages/homelab/src/cdk8s/src/resources/mcp-gateway/index.ts`
- Verified linter passes: `check-1password-items: OK — 52 item references and 106 field references verified`
- Verified `bun run --filter='./packages/homelab' typecheck` passes

### Remaining

- User still needs to populate `FASTMAIL_TOKEN` and `GMAIL_TOKEN` in 1Password `mcp-gateway-credentials` item when the tokens are ready, then run `bun scripts/snapshot-1password-vault.ts` and commit the updated snapshot — but that's a data step, not a code step, and CI will be green until then.

### Caveats

- The `{ optional: true }` means the Gmail and Fastmail MCP backends will silently not have credentials at pod start, until the 1Password fields are populated and the operator syncs. The pod itself starts fine.
