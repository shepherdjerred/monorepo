---
id: dpp-goal-llm-archive-creds
status: blocked
origin: packages/docs/plans/2026-06-13_discord-plays-pokemon-goal-nano.md
source_marker: true
---

# Wire SeaweedFS S3 creds for discord-plays-pokemon /goal observability

## What

T7 of the goal-nano plan added span synthesis (codex-trace.ts) and the
`LlmArchiveSpanProcessor` wrapper around the existing OTLP exporter — every
Codex turn / tool call gets a `gen_ai.*` span with token-usage attributes that
the archive processor wants to gzip + PUT to SeaweedFS.

The backend ships fine without S3 creds (the processor no-ops gracefully on
missing `LLM_OBSERVABILITY_ENABLED` / `S3_ENDPOINT`), but spans don't get
archived — defeating the point of T7 ("when a run goes badly, we can pull the
trace from SeaweedFS and replay what the model saw + did").

## Pre-req: 1Password fields

Add to the pokemon-config 1P item
(`vaults/v64ocnykdqju4ui6j6pua56xw4/items/hwyhh64dyu3s7w37q7oj7r4qn4`):

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

The values should be the same SeaweedFS S3 credentials used by birmel /
temporal / scout (cross-check `packages/homelab/src/cdk8s/src/resources/scout/index.ts`
for the existing pattern).

After adding, refresh the snapshot:

```bash
cd packages/homelab/src/cdk8s && bun run scripts/snapshot-1password-vault.ts
```

## Then wire the env vars

In `packages/homelab/src/cdk8s/src/resources/pokemon.ts`, where the
`TODO(todo:dpp-goal-llm-archive-creds)` marker lives, replace the marker
with:

```ts
AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({ secret, key: "AWS_ACCESS_KEY_ID" }),
AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({ secret, key: "AWS_SECRET_ACCESS_KEY" }),
AWS_ENDPOINT_URL: EnvValue.fromValue("http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333"),
S3_ENDPOINT: EnvValue.fromValue("http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333"),
S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
AWS_REGION: EnvValue.fromValue("us-east-1"),
...llmArchiveEnvVars(),
LLM_ARCHIVE_S3_PREFIX: EnvValue.fromValue("goals/discord-plays-pokemon"),
```

…and add `llmArchiveEnvVars` to the imports at the top.

## Verification

After a `/goal` run, the OTel trace `pokemon.goal.run` in Tempo should carry a
slim summary and per-turn spans should have an `llm.archive.url` attribute
pointing at the gzipped envelope in SeaweedFS under
`s3://llm-archive/goals/discord-plays-pokemon/…`.
