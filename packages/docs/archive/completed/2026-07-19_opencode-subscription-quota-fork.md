---
id: reference-completed-2026-07-19-opencode-subscription-quota-fork
type: reference
status: complete
board: false
---

# OpenCode Subscription Quota Fork

## Objective

Maintain `@shepherdjerred/opencode-quota` as a general-purpose
OpenCode plugin for Codex, Grok, Kimi, and other supported providers. Add
subscription quota support for Grok and Kimi while retaining upstream token
reporting and existing provider integrations.

## Decisions

- Maintain a scoped fork rather than waiting for upstream provider support.
- Preserve one unified `/quota`, sidebar, compact status, and token-report UI.
- Show every validated Grok quota window returned by the weekly credits and
  monthly included-usage endpoints.
- Support Kimi API keys and subscription OAuth without creating duplicate
  provider rows.
- Coordinate Kimi refresh-token rotation with the public Kimi companion plugin
  through the same provider-scoped cross-process lock.
- Label token-price calculations as API-equivalent cost. They are not invoices
  and do not account for subscriptions, credits, discounts, or overages.
- Derive limits, usage, period labels, and reset times from validated provider
  responses. Never embed values observed from one account as constants.
- Deploy from stable local clones and built filesystem entrypoints instead of
  requiring npm publication.

## Implementation

1. Fork `slkiser/opencode-quota`, create an isolated feature worktree, and
   rename the distributable package to `@shepherdjerred/opencode-quota` while
   retaining an `upstream` remote.
2. Add a canonical `xai` provider that reads standard OpenCode xAI OAuth,
   queries weekly credits and monthly included usage, validates both response
   contracts independently, and renders every available window.
3. Extend canonical `kimi-for-coding` support to recognize the public
   `kimi-for-coding-oauth` integration, official Kimi request headers, proactive
   token refresh, one forced refresh after a 401, rotating-token persistence,
   and cross-process refresh coordination. Preserve static API-key behavior.
4. Rename token-report cost columns and command descriptions to explicitly say
   API-equivalent cost, and add a concise billing disclaimer to reports and
   documentation.
5. Add contract, provider, auth, refresh, concurrency, persistence, metadata,
   formatting, and packaging tests. Use varied fixtures that cover multiple
   plans and response shapes rather than local account values.
6. Run the fork's complete typecheck, test, build, and package checks. Verify
   live provider output without exposing credentials or identifiers.
7. Fast-forward stable local clones to the merged fork branches, build them,
   link the Kimi companion into the quota clone's isolated dependency tree, and
   configure the server and TUI filesystem entrypoints.
8. Update both live and chezmoi-managed OpenCode configuration, enable
   `openai`, `xai`, and `kimi-for-coding`, and verify the local imports,
   provider credentials, models, and live quota responses.

## Acceptance Criteria

- Codex renders all windows returned by OpenAI and retains token reports.
- Grok renders independently validated weekly and monthly windows with values
  supplied by the active account's responses.
- Kimi renders all summary and rolling windows returned by the API for either
  static API-key or subscription OAuth authentication.
- Kimi OAuth refresh is safe across multiple OpenCode processes and the Kimi
  companion plugin.
- Token reports use `API equivalent` terminology and state that values are not
  billed spend.
- No source, fixture, or documentation embeds local credentials, account IDs,
  allowance values, usage values, temporary worktree paths, or subscription
  tiers.
- The local server and TUI entrypoints load from the built quota clone.
- Live and chezmoi-managed configuration match after deployment.
