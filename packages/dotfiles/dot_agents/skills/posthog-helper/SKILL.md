---
name: posthog-helper
description: Safely use the repository's PostHog CLI and API for analytics, event-schema discovery, replay, flags, experiments, observability, and governed PostHog changes.
---

# PostHog Helper

Use `toolkit posthog api` as the agent-first interface to the configured PostHog
project. The Fish environment provides `POSTHOG_CLI_API_KEY` through 1Password;
toolkit supplies project `549883` unless the environment selects another
project. Keep that project-scoped credential path instead of creating a second
token store.

## Authenticate and discover

```bash
toolkit posthog --version
toolkit posthog api --agent-help
toolkit posthog api search read-data-schema
toolkit posthog api info read-data-schema
toolkit posthog api call read-data-schema '{"query":{"kind":"events"}}'
```

Do not run `toolkit posthog login` in normal repository work. It writes a personal
token outside the 1Password-backed environment. If credentials are unavailable,
repair the dotfiles setup; never paste, print, or persist an API key.

The command surface changes quickly. For schema-first API calls, CLI discovery,
and using the API without inventing JSON, read
[CLI and API operations](references/cli-and-api.md).

## Read data schema first

Every analytics task follows this order:

1. `search` for the capability; run `info` for each candidate tool.
2. Follow every returned schema hint with `schema <tool> <field>`.
3. Use `read-data-schema` to establish real event names, properties, values,
   groups, and time range before querying data.
4. Prefer a typed `query-*` tool. Use SQL only when it is necessary and the
   relevant tables and columns have been confirmed.
5. Use `--json` when another program will consume a result.

Never assume that an event such as `$pageview` exists just because it is common
in another project. Read [analytics and data governance](references/analytics-and-data.md)
for identity, event design, privacy, replay, and the distinction between source
configuration and observed data.

## Product and observability work

Use analytics to answer a defined product question, then inspect supporting
replays or errors with the least-sensitive access necessary. Keep feature flags
and experiments separate:

- A **flag** controls delivery and should have a stable identity, targeting,
  rollout, owner, and cleanup decision.
- An **experiment** tests a written hypothesis with a declared exposure,
  metric, sample-size/run-time plan, and stop/launch decision.
- **AI observability, error tracking, and logs** are operational signals; apply
  their own privacy and retention settings before expanding capture.

See [product and operations](references/product-and-operations.md) for current
feature, experiment, replay, error, logs, and LLM-observability practices.

## External-write boundary and ingestion proof

PostHog configuration and data changes are external mutations. Require explicit
user direction, inspect the target and input schema, dry-run the exact payload,
and confirm only the approved action:

```bash
toolkit posthog api info <tool>
toolkit posthog api schema <tool> <field>
toolkit posthog api call --dry-run <tool> '<validated-json-input>'
toolkit posthog api call --confirm <tool> '<validated-json-input>'
```

Do not treat a source check or HTTP capture response as stored-event proof.
They prove different layers:

1. `bun scripts/checks/check-analytics-sites.ts` validates repository tracker source.
2. A capture response establishes only that the endpoint accepted a request.
3. Live Events or a schema-backed read establishes that PostHog stored and made
   the event queryable.

## Vendor-provided skills

Discover specialized PostHog skills before unfamiliar work:

```bash
toolkit posthog api skill list
toolkit posthog api skill install <skill-id>
```

Do not install a vendor skill blindly into this repository. Confirm its target
and inspect its content first; durable local guidance belongs in this tracked
skill tree. The dated, canonical 50-source evidence set is in
[the PostHog source ledger](references/sources.md).
