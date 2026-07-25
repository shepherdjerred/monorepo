---
id: log-2026-07-19-opencode-quota-followup
type: log
status: complete
board: false
---

# OpenCode Quota Follow-up

## OpenAI Five-Hour Investigation

OpenAI normally exposes the Codex five-hour and weekly quota windows through one
rate-limit response. Consumers must classify the windows by duration rather than
assuming that `primary_window` always means five hours:

- `18,000` seconds: five hours
- `604,800` seconds: one week

The local account returned both windows through July 7, 2026. Starting July 12,
the same account credential returned only the weekly window in
`primary_window`, with `secondary_window` set to `null`. Current reads through
the canonical endpoint, the compatibility endpoint, capability-query and header
variants, and Codex app-server all return that same weekly-only shape.

The timing matches OpenAI's July 12 announcement that it was temporarily removing
the five-hour usage restriction for Plus, Business, and Pro plans. A public Codex
issue captured an equivalent transition within one running task: the 300-minute
primary window disappeared while the existing 10,080-minute secondary window
moved into the primary slot. OpenAI's pricing page still documents the normal
five-hour window, so the temporary operational behavior and baseline
documentation are currently inconsistent.

Sources:

- [OpenAI announcement](https://x.com/thsottiaux/status/2076365965915467978)
- [Same-task quota transition](https://github.com/openai/codex/issues/32707)
- [Codex pricing and baseline limits](https://learn.chatgpt.com/docs/pricing)
- [Independent duration-based parsing fix](https://github.com/robinebers/openusage/commit/e1ddf233faf118aefcadd80dc525064fe44cb689)

The available evidence strongly supports the temporary policy change as the
explanation for the local transition, but it does not prove the backend's exact
enforcement semantics, universal rollout, or restoration date. The quota plugin
is not suppressing a returned window; it renders the weekly-only payload it
currently receives.

## Grok Investigation

The existing xAI OAuth credential can read the official Grok endpoints:

- `/v1/billing` returns the monthly included quota, current usage, and the
  billing period.
- `/v1/billing?format=credits` returns the current
  weekly credits period and on-demand/prepaid fields, but no included-quota
  amount for this account.
- `/rest/subscriptions` reports an active Grok subscription.

`@slkiser/opencode-quota@3.11.2` does not support xAI quota collection. Its
provider registry can support a first-class `xai` provider, but no implementation
was made because the user requested a design discussion before code changes.

## Session Log - 2026-07-19

### Done

- Verified the current OpenAI response through all known safe structured quota
  routes and request-header variants.
- Verified current Codex app-server quota output and compared it with local
  historical Codex session snapshots.
- Established that the local five-hour window disappeared between July 7 and
  July 12 while the weekly window remained and moved into the primary slot.
- Correlated the transition with OpenAI's July 12 temporary-removal announcement
  and independent public reports and client fixes.
- Verified Grok's monthly billing and subscription endpoints with the existing
  OAuth credential without exposing credentials or account identifiers.
- Cloned `slkiser/opencode-quota` and `jasonmit/opencode-codex-usage` into the
  temporary workspace for read-only source inspection.
- Made no OpenCode configuration or plugin implementation changes.

### Remaining

- Discuss and approve the durable Grok integration approach before implementing
  it.
- If approved, add xAI as a first-class quota provider, verify the unified TUI
  surfaces and token-cost commands, and reconcile the managed configuration with
  the concurrent local Kimi plugin path.

### Caveats

- OpenAI describes the five-hour removal as temporary but has not published a
  restoration date.
- The current pricing page still documents five-hour limits, which conflicts with
  the temporary operational behavior.
- The causation is strongly supported by timing and matching payload transitions,
  but OpenAI has not documented the backend response-shaping rule itself.
- Repository changes remain uncommitted in the
  `feature/opencode-codex-usage` worktree.

## Session Log — 2026-07-19 (Implementation Follow-up)

### Done

- Implemented and merged first-class xAI and Kimi subscription quota support in the maintained quota fork.
- Verified the active OpenAI weekly window, Grok weekly and monthly windows, and both Kimi usage windows from the local builds.
- Deployed the merged forks through stable local filesystem clones instead of npm publication.

### Remaining

- None.

### Caveats

- OpenAI still returns only the weekly Codex window for this account; the plugin continues to render all windows returned by the API.
- The original research section predates implementation and is retained as historical context.
