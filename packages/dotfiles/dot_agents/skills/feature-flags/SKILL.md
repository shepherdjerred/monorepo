---
name: feature-flags
description: >-
  Layered configuration and feature flags for shepherdjerred/monorepo —
  @shepherdjerred/config (flag → env → file → default) and
  @shepherdjerred/feature-flags (OpenFeature over self-hosted Flipt).
  Load BEFORE adding a config value, adding an env var to a service, gating a
  new feature, planning a rollout or ramp, adding an allowlist or ID list, or
  deciding where a tunable belongs. Also load when the user mentions Flipt,
  OpenFeature, feature flags, or dynamic config.
---

# Feature flags and layered config

## The policy

> For any app we wrote or control, environment variables are for **credentials
> and bootstrap**. Everything else is a **feature flag**.

Shipping a new feature? Land it behind a flag defaulted off, enable in beta,
ramp, then remove the flag. That is the default path, not an exception.

## Which layer — six questions, first match wins

1. Is it a secret? → 1Password → Kubernetes Secret.
2. Is it needed before the flag client exists? → **bootstrap env**
   (`FLIPT_URL`, `FLIPT_ENVIRONMENT`, `FLIPT_NAMESPACE`, application
   `ENVIRONMENT`, `PORT`, `DATABASE_URL`, `TEMPORAL_WORKER_ROLE`).
   `ENVIRONMENT` describes the application deployment;
   `FLIPT_ENVIRONMENT` selects Flipt's isolated stage repository and
   `FLIPT_NAMESPACE` selects the product flag keyspace inside it. Both Flipt
   selectors are required whenever `FEATURE_FLAGS_MODE=flipt`.
3. Does an end user own it? → a database row.
4. Shared across packages or languages? → JSON catalog + JSON Schema.
5. Changes only when code changes? → a constant.
6. Otherwise → **a flag**.

## Adding a config key

```ts
const booleanFromText = z.preprocess(
  (value) => value === "true" ? true : value === "false" ? false : value,
  z.boolean(),
);

const DEFINITION = {
  myFeatureEnabled: {
    schema: booleanFromText, // env/file values arrive as STRINGS
    sources: ["flag", "env", "default"],
    default: false,               // MUST be current production behavior
  },
} as const;
```

Names derive from the key: `myFeatureEnabled` → flag `my-feature-enabled`, env
`MY_FEATURE_ENABLED`, file `my.feature.enabled`. Override per key with `names`.

`sources: ["env"]` is an assertion that a key is **bootstrap**. That is what
makes the policy machine-checkable instead of prose.

Flags of your own also need:

- the consuming namespace added to `CONSUMER_NAMESPACES` in
  `packages/homelab/src/cdk8s/src/cdk8s-charts/flipt.ts` — Flipt has no auth, so
  that list is the access control;
- `FEATURE_FLAGS_MODE`, `FLIPT_URL`, `FLIPT_ENVIRONMENT`, and the exact product
  `FLIPT_NAMESPACE` on the service's cdk8s Deployment when the mode is `flipt`;
- `FEATURE_FLAGS_MODE=disabled` wherever tests run.

## Rules

- **The default is a required argument and must be current production
  behavior.** It is what a cold start and a backend outage both resolve to.
- **`targetingKey` is required.** It is Flipt's bucketing key; a shared constant
  puts the whole fleet in one hash slot and turns any ramp into 0% or 100%.
- **Mark credentials `sensitive: true`** so the startup dump prints a digest.
- **Mark per-entity keys `targeted: true`** so change detection caches per
  entity rather than logging a "change" on every alternation.
- **Remove the flag when the rollout is done.** One that outlives its rollout is
  a confusing branch.

## Where a flag does nothing

- **Per-call** — fully live. What you want.
- **Session-scoped** — takes effect next session. Say that, don't say "live".
- **Boot-wired** — read once to *construct* something. **Does nothing until
  restart.** Move the read to a call site or skip it.

ffmpeg encoder args are fixed for the process's lifetime regardless of where
they are read; flipping one drops the stream exactly as a redeploy would.

For a synchronous call site, use `createConfigSnapshot` — seeded with current
values, refreshed in the background, never empty before the first refresh.

## Do NOT flag

- **Capability grants**, while Flipt has no auth. birmel's `TRUSTED_USER_IDS`
  gates shell execution and repo writes; any tailnet device could grant itself
  that. Ordinary allowlists are a primary use case — capability grants are not.
  Same for streambot's `VOICE_CAPTURE_ENABLED` (persists human audio).
- **Infrastructure shape** — cdk8s resources, image tags, replicas, limits.
- **CI deciders** — must be reproducible per-commit, and CI cannot reach
  in-cluster Flipt.
- **One-shot CLIs** (`packages/toolkit`) — no running process to flip.
- **Where a better mechanism exists** — Temporal Schedules have native pause;
  `packages/temporal/CLAUDE.md` says a competing `enabled` flag "would fight the
  UI".
- **Money-path constants** with conservation invariants, unless the value is
  snapshotted onto the row at placement first.

## Flipt gotchas (learned by running it, not from docs)

- **Environment and namespace are separate selectors.** Environments isolate
  stage repositories (`beta`, `prod`); namespaces isolate product flag catalogs
  (`scout`, `temporal`, and so on). A Flipt namespace is unrelated to a
  Kubernetes namespace.
- **v2 defaults to IN-MEMORY storage.** Without an explicit local backend it
  accepts writes and loses them on restart.
- **`enabled` is the flag's default; rollouts override it.** A 30% rollout to
  `true` on a flag already `enabled: true` is a no-op. Ramp-ups set
  `enabled: false` with a rollout to `true`.
- **An unknown key throws** from the client, and `reason` is
  `DEFAULT_EVALUATION_REASON` for true, false, and a rollout miss alike.
  `listFlags()` is the absence oracle.

## Reference

- `packages/config/AGENTS.md` — resolver contract, absence-vs-answer rule.
- `packages/feature-flags/AGENTS.md` — OpenFeature facade, failure classes.
- `packages/docs/wiki/src/content/docs/explanation/homelab/configuration.md` —
  the human page, including the security boundary.
