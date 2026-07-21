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

## Session Log - 2026-07-19

### Done

- Implemented, tested, and merged the Kimi quota companion as version `1.5.0`.
- Implemented, tested, and merged OpenAI, Grok, and Kimi support in the scoped quota fork as version `3.12.0`.
- Fast-forwarded `~/git/opencode-kimi-full` and `~/git/opencode-quota` to the merged fork branches.
- Installed dependencies, built both clones, and passed 89 Kimi tests plus 1,222 quota tests.
- Linked the local Kimi clone into the quota clone so the isolated runtime can resolve the companion quota export.
- Configured the local Kimi root, quota server entrypoint, and quota TUI entrypoint in both live and chezmoi-managed configuration.
- Enabled `openai`, `xai`, and `kimi-for-coding`; verified OpenAI, Grok, and Kimi live quota responses without printing credentials or account identifiers.
- Verified the local server, TUI, and companion modules import successfully and the Kimi model aliases resolve in OpenCode.

### Remaining

- None.

### Caveats

- Restart the currently running OpenCode TUI to load the changed plugin configuration.
- Re-run `corepack pnpm link ~/git/opencode-kimi-full` from `~/git/opencode-quota` after reinstalling quota dependencies because the local companion link lives under ignored `node_modules`.
- Update the clones with `git pull`, reinstall dependencies when lockfiles change, and rebuild before expecting new fork code to become active.

## Session Log — 2026-07-19 (Homepage Remaining + Claude Code Usage)

### Done

- Merged `shepherdjerred/opencode-quota#2` so compact percentage lines start with `Remaining:` or `Used:`.
- Merged `shepherdjerred/opencode-quota#3` so Claude Code quota uses Claude CLI/OAuth credentials without requiring OpenCode Anthropic chat setup.
- Enabled `anthropic` in live and chezmoi-managed `enabledProviders`.
- Verified compact output shape including Claude 5h and weekly windows.

### Remaining

- Restart the running OpenCode TUI to load the rebuilt local plugin and Anthropic provider.

### Caveats

- Claude Code usage is display-only here; OpenCode auth still has only OpenAI, Kimi, and xAI credentials.
