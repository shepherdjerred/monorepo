---
id: log-2026-07-29-glitter-openai-usage-attribution
type: log
status: complete
board: false
---

# Glitter OpenAI usage attribution

The OpenAI usage dashboard showed 166,345,963 input tokens and 2,492 requests
for the selected project window. Production Tempo traces attribute only a small
fraction of that input volume to the Glitter context-refresh workflow.

For `2026-07-29T00:00:00Z` through `2026-07-30T00:00:00Z`, the Glitter
call sites recorded:

| Call site                       | Successful calls | Failed calls | Input tokens | Cached input tokens | Output tokens |
| ------------------------------- | ---------------: | -----------: | -----------: | ------------------: | ------------: |
| `glitter-context-style-card`    |               61 |            6 |      803,067 |             328,272 |       168,962 |
| `glitter-context-relationships` |                4 |            0 |      133,892 |              66,940 |           477 |
| **Total**                       |           **65** |        **6** |  **936,959** |         **395,212** |   **169,439** |

The Glitter input total is 0.563% of the dashboard's 166,345,963 input tokens.
All OpenAI-instrumented production services together recorded 2,790,730 input
tokens in the same UTC window, so the dashboard's dominant input volume came
from clients outside the traced production services.

The dashboard's authoritative per-key monthly spend attribution is:

| API key / project |      Spend |    Share |
| ----------------- | ---------: | -------: |
| MacBook / Misc    |      $8.18 |   55.05% |
| Temporal          |      $3.01 |   20.26% |
| Pokémon           |      $2.87 |   19.31% |
| GitHub Actions    |      $0.56 |    3.77% |
| Scout beta        |      $0.24 |    1.62% |
| **Total**         | **$14.86** | **100%** |

The entire Temporal key, including Glitter and other Temporal workloads, cost
$3.01. Glitter therefore cost no more than $3.01 for the month. A prior
standard-rate calculation from trace token attributes produced a synthetic
$7.99 estimate, but that conflicts with the authoritative key-level charge and
must not be treated as actual spend. The dashboard's billing accounting is the
source of truth.

The call count was elevated by production acceptance work rather than the
intended steady state. Four complete pre-cache fixed-time generations were run
while validating deterministic output. After the immutable generation-artifact
cache shipped, the first cache-backed run persisted nine reusable style-card
artifacts and then failed closed on project quota. Later retries reused those
artifacts and failed before generating the four missing cards.

## Workflow Friction

- The `monorepo-docs` skill briefly directed operators to run `bun run
check-docs`, a script that does not exist at the root; that guidance was
  already corrected to `bun run check-todos` the same day, in PR #1784
  (commit `befcb51f1`). `bun run check-todos` invokes
  `packages/docs-board/src/cli/check-docs.ts` and performs the full
  document-model check.

## Session Log — 2026-07-29

### Done

- Queried production Tempo for every Glitter OpenAI call in the dashboard day.
- Separated Glitter usage from all instrumented production OpenAI usage and
  from the project-wide dashboard totals.
- Calculated the standard-price Glitter estimate from measured input, cached
  input, and output tokens.
- Reconciled the elevated call count with the rollout chronology and immutable
  generation-cache deployment.

### Remaining

- Use the OpenAI dashboard's API Keys and Services breakdowns to identify the
  client responsible for the remaining project-wide input volume.
- Restore the Temporal worker project's quota before completing the four
  missing style cards and the context-refresh acceptance gates.

### Caveats

- The 166-million-token dashboard total is not expected from Glitter and is not
  attributable to Glitter by production telemetry.
- The API-key table proves spend attribution, not token attribution. Use the
  API Key Usage view to compare the MacBook and Temporal token totals directly.
- The Temporal key's $3.01 is an upper bound for Glitter because other Temporal
  workflows use the same credential.

## Session Log — 2026-07-29 (API-key reconciliation)

### Done

- Reconciled all nine active API-key rows with the dashboard's $14.86 July
  total.
- Confirmed the MacBook key is the largest spender at $8.18 and the Temporal
  key accounts for $3.01.
- Replaced the conflicting trace-derived price estimate with the authoritative
  per-key billing result.

### Remaining

- Open API Key Usage and compare MacBook versus Temporal if exact per-key token
  counts, models, or daily request timing are needed.
- Restore the Temporal worker project's quota before completing the four
  missing style cards and context-refresh acceptance.

### Caveats

- The screenshot attributes spend, not the dashboard's 166,345,963 input
  tokens. The spending pattern strongly points away from Glitter, while exact
  token ownership requires the API Key Usage breakdown.
- Temporal's $3.01 includes every workload using that key, so it is the strict
  monthly upper bound for Glitter rather than an exact Glitter-only charge.

## Session Log — 2026-07-29 (quota restoration and cached acceptance)

### Done

- Verified the cache-enabled production worker and recovery-verified pinned
  corpus snapshot.
- Completed the first dry run by reusing nine immutable generation artifacts
  and generating only the four missing style cards.
- Completed a second byte-identical dry run and the real refresh with zero
  additional OpenAI calls; all three returned proposal SHA-256
  `9f558af01bf18f2082499c61cd400b44b27bb1e0f93e878978c1cf785e582538`.
- Opened generated-context PR #1834 and passed focused build, typecheck, test,
  and lint for Glitter context, Birmel, Scout data, and the Glitter app.

### Remaining

- Complete human review and current-head Buildkite #7145 for PR #1834.
- Merge PR #1834, run merged-main and production consumer smoke checks, then
  deliberately unpause `glitter-context-refresh-weekly`.
- Complete and archive the live rollout plan and related TODOs.

### Caveats

- The weekly schedule remains deliberately paused.
- PR #1834 requires subjective human review and is never auto-merged.
- The generated-context proposal is cached; review, CI, and real-run retries do
  not require another OpenAI generation.
- Current-head Buildkite #7145 is scheduled but cannot start while the
  dedicated CI node `liskov` is offline; Kubernetes last received its heartbeat
  at 11:04 PDT and deliberately does not fall back to the production node.
