# PostHog CLI and API operations

`posthog-cli api` is an agent-oriented capability layer. Its tools and schemas
may change independently of the local CLI version, so discover instead of
guessing.

```bash
posthog-cli --version
posthog-cli api --agent-help
posthog-cli api search <capability>
posthog-cli api info <tool>
posthog-cli api schema <tool> <field>
posthog-cli api call --json <tool> '<input-json>'
```

## Schema-first read path

1. Name the question and the required output, not a presumed endpoint.
2. Search capabilities, then inspect each candidate's `info` response.
3. Resolve schema hints before constructing nested data.
4. Call `read-data-schema` for the relevant event names, properties, property
   values, groups, or date range.
5. Prefer a typed tool. Confirm table and column names before an SQL query.
6. Read and validate the result's time range, filters, sampling, and grouping
   before making a product claim.

This is especially important because a project can have different SDKs,
historical event names, or privacy settings than another PostHog deployment.

## Mutation path

1. Obtain explicit authorization for the single target change.
2. Inspect the target and command schema.
3. Form one precise payload and call it with `--dry-run`.
4. Compare the dry-run result to the approved outcome.
5. Re-run exactly that payload with `--confirm`, then re-read its state.

Do not let a batch-oriented capability broaden authority. Never place a key in
an argument, script, issue, or generated file. Use the 1Password-backed
environment instead.

## Skills

`posthog-cli api skill list` discovers vendor-provided task guidance. Treat it
as external code/documentation: inspect the target and content before install,
and do not overwrite this repository's durable skill guidance without an
authorized change.

## Useful references

- [PostHog CLI](https://posthog.com/docs/cli) — official installation and CLI
  entrypoint.
- [API overview](https://posthog.com/docs/api) — official API surface.
- [Query API](https://posthog.com/docs/api/queries) — analytics query model.
- [Source ledger](sources.md) — dated sources for the current operational
  workflow.
