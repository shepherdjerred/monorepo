---
id: log-opencode-provider-stats-audit-2026-07-27
type: log
status: complete
board: false
---

# OpenCode Provider Stats Audit

Audit OpenCode usage-window reporting, per-session cost estimates, and model/effort configuration for Claude, OpenAI, Kimi, and Grok.

## Verdict

The quota fork is useful but does not yet satisfy the requested contract of showing every relevant subscription limit and a meaningful per-session dollar estimate.

- The sidebar's native `$0.00 spent` is expected for OpenAI OAuth because OpenCode deliberately zeroes subscription model prices. It is not a usage or billing statement.
- The quota plugin initially calculated API-equivalent dollars only in `/tokens_*` reports. The implementation follow-up now restores list prices to native Context `spent` while keeping the custom session-token block token-only.
- OpenAI and Grok model IDs resolve in the quota plugin, but its pricing snapshot drops Models.dev context-price tiers and materially underprices long-context turns. Kimi OAuth pricing is entirely broken because its provider/model IDs do not resolve to Models.dev keys.
- Claude, OpenAI, and Kimi omit real secondary limit surfaces. Grok is currently unavailable because the quota plugin cannot refresh its expired OAuth token.
- Kimi advertises K3 effort values `low`, `high`, and `max`, while K2.7 intentionally has no provider-native effort selector. The account is entitled to `k3-256k`, but the current OpenCode catalog does not expose it.

## Live Snapshot

Observed on 2026-07-27 with OpenCode `1.18.5` and the live config matching chezmoi:

| Provider   | Live quota result                                                     | Models/effort                                                                   | Session dollars                                                     |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Claude     | 5h and weekly                                                         | Quota only; Claude subscription chat is not configured in OpenCode              | Not requested                                                       |
| OpenAI Pro | Weekly only in the current account response; 5h absent at that moment | GPT-5.6 exposes `none/low/medium/high/xhigh/max`; current session uses Sol/high | Native `$0`; flat API-equivalent estimate is underpriced            |
| Kimi Code  | 5h and weekly                                                         | Static K2.7, HighSpeed, K3; Kimi advertises K3 `low/high/max`                   | Native `$0`; API-equivalent broken                                  |
| Grok       | Unavailable: OAuth token expired                                      | Multi-agent 4.20 exposes `low/medium/high/xhigh`                                | Native estimate exists; flat API-equivalent estimate is underpriced |

The audited session `ses_083c90071ffeMS62qT43oo39C2` illustrates the cost ambiguity:

| Measure                     |         Value | Meaning                                                                                    |
| --------------------------- | ------------: | ------------------------------------------------------------------------------------------ |
| Sidebar                     | `$0.00 spent` | Current native OpenCode display, zero-priced for OpenAI OAuth                              |
| Stored native session cost  |      `$22.94` | Persisted OpenCode cost; it covers the Grok turns while OpenAI OAuth turns are zero-priced |
| Quota plugin API equivalent |     `$101.67` | Current plugin result; known to be underpriced because it drops context tiers              |
| Tier-aware API equivalent   |     `$156.35` | Best estimate from the same Models.dev snapshot with context tiers applied                 |
| Tier-aware OpenAI portion   |     `$133.41` | GPT-5.6 Sol API-equivalent estimate                                                        |
| Tier-aware Grok portion     |      `$22.94` | Grok 4.5 API-equivalent estimate; matches the stored native Grok cost                      |

This session has used more than one provider over its lifetime. None of these values is the amount charged to a subscription. The tier-aware total was `$156.3492892` (`$133.412852` OpenAI and `$22.9364372` Grok) at the audit snapshot.

## Findings

### P1: The visible session cost does not implement the requested subscription view

OpenCode's OpenAI OAuth plugin replaces all model prices with zero, so native cost for those turns is zero by design. The quota plugin correctly labels its own reports as API-equivalent, but the sidebar extension only appends token counts (`~/git/opencode-quota/src/lib/session-tokens.ts:25-42`, `src/lib/tui-sidebar-format.ts:14-29`). Users therefore see native `$0.00 spent` beside a token counter with no replacement estimate.

The right subscription UI has three separate fields:

| Field                  | Subscription OAuth value                                                    |
| ---------------------- | --------------------------------------------------------------------------- |
| Incremental charge     | `$0` while included quota is used; unknown when paid extra usage is enabled |
| API-equivalent cost    | Best-effort token estimate from a versioned pricing snapshot                |
| Provider credits/quota | Provider-native credits or window percentage when exposed                   |

Calling the estimate billed subscription spend would be incorrect. The initial recommendation was a separate `API eq. $X` row, but the final UI decision uses native Context `spent` as the sole sidebar list-price estimate and keeps the custom session-token block token-only.

### P1: Kimi per-session cost is entirely missing

All 332 saved `kimi-for-coding-oauth` assistant messages are unpriced. The significant row is 330 K3 messages with 1,357,675 new input, 21,139,968 cached input, 85,833 output, and 75,416 reasoning tokens.

`SOURCE_PROVIDER_ALIASES` does not map `kimi-for-coding-oauth` to `moonshotai`, and the model resolver does not map subscription IDs to current pricing IDs (`~/git/opencode-quota/src/lib/quota-stats.ts:187-215`, `260-293`):

| Subscription model          | Models.dev pricing model   |
| --------------------------- | -------------------------- |
| `k3` / `k3-256k`            | `kimi-k3`                  |
| `kimi-for-coding`           | `kimi-k2.7-code`           |
| `kimi-for-coding-highspeed` | `kimi-k2.7-code-highspeed` |

The existing pricing resolver tests cover `moonshotai/kimi-k2.5`, not the custom OAuth provider or current subscription aliases.

### P1: Relevant quota windows and balances are omitted

| Provider | Implemented                                               | Missing or misleading                                                                                                                                                                              |
| -------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude   | General 5h and general weekly                             | Conditional Sonnet/Opus/product weekly pools and extra-usage credits/limit                                                                                                                         |
| OpenAI   | Recognized 5h, weekly, monthly, legacy code review        | `additional_rate_limits`, credit details, spend control, promo/reset credits, reached reason                                                                                                       |
| Kimi     | Coding weekly and rolling 5h                              | Shared membership monthly cap and Extra Usage balance/spend cap                                                                                                                                    |
| Grok     | Weekly credits plus a parsed legacy monthly billing shape | Official current consumer contract is one shared weekly pool plus Extra Usage Credits; the monthly row must be identified as on-demand/billing data rather than another included subscription pool |

The live OpenAI response currently includes an additional `GPT-5.3-Codex-Spark` limit, `spend_control`, `promo`, and `rate_limit_reset_credits`; none appears in the plugin. The Claude parser requires both general windows and discards all other fields (`~/git/opencode-quota/src/lib/anthropic.ts:342-358`). Kimi's official docs state that monthly membership usage can freeze Kimi Code even when its 5h and weekly rows remain available.

### P1: OpenAI and Grok quota auth goes stale

The quota implementation reads OAuth state but does not call the providers' refresh flows. Both OpenAI and xAI return an error immediately when `expires` is in the past (`~/git/opencode-quota/src/lib/openai.ts:231-242`, `src/lib/xai.ts:234-245`). Kimi already solves this through its companion's refresh-safe client.

The live xAI token expired at `2026-07-27T09:24:53Z`, which is why the screenshot shows a Grok error and the cache reports `unavailable`. OpenCode itself can refresh xAI on a model request, but quota should not require spending a model turn to restore observability.

### P1: Context-price tiers are discarded

Models.dev prices some models differently above a context threshold, but the quota fork's snapshot schema retains only flat `input`, `output`, `cache_read`, `cache_write`, and `reasoning` buckets. `buildSnapshotFromApi` reads only the recognized flat keys from `model.cost` and drops its nested tier definitions (`~/git/opencode-quota/src/lib/modelsdev-pricing.ts:10-35`, `371-423`). The cost calculator consequently applies one rate to every turn.

For the audited session, this produces the plugin's `$101.67` result instead of the tier-aware `$156.35` estimate. The tier-aware Grok portion is `$22.94`, exactly matching OpenCode's stored native cost, so the earlier apparent pricing drift was an artifact of the fork's flattened snapshot rather than evidence of changed Grok prices.

### P2: Kimi's effective model catalog diverges from discovery

The authenticated Kimi endpoint currently returns:

| Model                       |   Context | Effort                                 |
| --------------------------- | --------: | -------------------------------------- |
| `k3`                        | 1,048,576 | `low`, `high`, `max`; default `high`   |
| `k3-256k`                   |   262,144 | `low`, `high`, `max`; default `high`   |
| `kimi-for-coding`           |   262,144 | Thinking always on; no effort variants |
| `kimi-for-coding-highspeed` |   262,144 | Thinking always on; no effort variants |

The live OpenCode catalog exposes only the three statically configured models, omitting `k3-256k`. The static K3 entry exposes `low/high/max` (`packages/dotfiles/private_dot_config/private_opencode/private_opencode.jsonc.tmpl:112-126`), so selecting K2.7 and seeing no provider-native effort control is correct behavior.

The custom plugin's login-time config generator includes discovered effort variants. Its runtime `applyDiscoveryToModels` path can also add an unknown discovered ID by cloning a base model, but only applies display name, context, and media metadata rather than discovered variants (`~/git/opencode-kimi-full/src/index.ts:310-365`). That code does not explain why `k3-256k` is absent from `opencode models kimi-for-coding-oauth`; the root cause remains unresolved.

### P2: Provider metadata and effective Kimi variants can differ

There is no confirmed OpenAI or Grok effort gap in the audited catalog. OpenCode `1.18.5` exposes GPT-5.6 `none/low/medium/high/xhigh/max`, and `grok-4.20-multi-agent-0309` exposes `low/medium/high/xhigh`.

Kimi's authenticated endpoint advertises only `low/high/max` for K3, while OpenCode's generic reasoning-variant synthesis may additionally expose `medium` in the effective catalog. The raw provider metadata, static config, and the actual `/variants` result should therefore be reported separately rather than treating one as authoritative for all three surfaces.

### P2: Tests can call the live Kimi account

The Kimi companion repository passes 89 tests. The quota fork passes 1,222 tests but fails two companion-resolution tests because the local linked dependency escapes the fake package tree and imports the real Kimi companion. Those tests fetched live account usage instead of fixture payloads. This is a test-isolation and credential-safety defect, not merely a local package-manager issue.

## Implementation Follow-up

The local `~/git/opencode-quota` build now:

- Keeps API-equivalent estimates in `/tokens_*` reports instead of duplicating them beneath sidebar session tokens.
- Preserves and applies Models.dev context-price tiers per message, including cached prompt tokens when selecting a tier.
- Retains historical pricing keys across snapshot refreshes so saved Cursor/Copilot usage remains priceable.
- Prefers isolated OpenCode package-cache Kimi companions before the development link, preventing tests from reaching the live account.
- Restores API-list prices to effective OpenAI OAuth models after Codex zeroes them, matching Grok's native Context `spent` semantics for new messages.
- Adds native Kimi prices to live and chezmoi-managed model config and maps Kimi OAuth model IDs to Moonshot pricing IDs.

Before the final sidebar simplification, the screenshot's `Test message` session (`ses_05b1104adffeXaLIuzH0Lx6gtU`) was verified against the built `dist` output: 24K new input, 95K cached input, 453 output, and an API-equivalent value of `$0.194405`. That value remains available in token reports but is no longer duplicated in the session-token block.

The mixed Kimi/Grok/Codex session (`ses_05af1f93effeC45ds9MjbVFwf4`) now resolves all three models at `$0.1330364` without incomplete pricing. Fresh model-catalog processes show nonzero native costs for `openai/gpt-5.6-sol` and `kimi-for-coding-oauth/k3`.

OpenCode's model dialog already exposes effort variants for OpenAI, Kimi K3, and Grok. It opens the effort dialog only when the selected model has no saved variant. Clearing the saved Kimi K3 and Grok 4.5 entries from `~/.local/state/opencode/model.json` makes their next selections follow the same model-then-effort flow as a first-time OpenAI model selection; the newly chosen effort is then remembered.

## Remaining Fix Order

1. Render all provider-native limit families and balances, preserving unknown named windows instead of dropping them.
2. Add refresh-safe OpenAI and xAI quota clients using the same single-flight/persist pattern as Kimi.
3. Add `k3-256k` to static config, investigate why discovery does not expose it, and merge discovered variants into the effective model config.
4. Record pricing snapshot timestamp/source in reports and optionally preserve per-message native list-price estimates for historical comparison.

## Sources

- [OpenAI Codex pricing, plans, limits, and credits](https://developers.openai.com/codex/pricing/)
- [OpenAI Codex models and effort modes](https://developers.openai.com/codex/models/)
- [Kimi OpenCode integration](https://www.kimi.com/code/docs/en/third-party-tools/opencode.html)
- [Kimi model configuration](https://www.kimi.com/code/docs/en/kimi-code/models.html)
- [Kimi membership quotas and Extra Usage](https://www.kimi.com/code/docs/en/kimi-code/membership.html)
- [Grok consumer usage and subscription FAQ](https://docs.x.ai/grok/faq)
- [xAI reasoning controls](https://docs.x.ai/developers/model-capabilities/text/reasoning)
- [Claude Code costs and usage](https://code.claude.com/docs/en/costs)
- [OpenCode 1.18.5 OpenAI OAuth implementation](https://github.com/anomalyco/opencode/blob/e5cc278dec9294a627a7b05f47ce6a564408c1a2/packages/opencode/src/plugin/openai/codex.ts)
- [OpenCode 1.18.5 session cost implementation](https://github.com/anomalyco/opencode/blob/e5cc278dec9294a627a7b05f47ce6a564408c1a2/packages/opencode/src/session/session.ts)

## Session Log — 2026-07-27

### Done

- Audited live and chezmoi OpenCode `1.18.5` configuration plus `~/git/opencode-quota` and `~/git/opencode-kimi-full`.
- Queried secret-safe live quota/model metadata for Claude, OpenAI, Kimi, and Grok.
- Recomputed local session/history token costs, including Models.dev context tiers, and identified broken Kimi pricing resolution.
- Verified provider windows, balances, models, and effort controls against current first-party documentation and pinned OpenCode source.
- Ran Kimi's 89 tests successfully and the quota fork's 1,224 tests, finding two unsafe companion-resolution failures.
- Corrected the audit after adversarial review: the quota fork drops context-price tiers, while OpenAI and Grok effort variants are already complete in the audited catalog.
- Implemented context-tier pricing, historical snapshot retention, and Kimi test isolation in `~/git/opencode-quota`.
- Verified TypeScript, the production build, and all 1,240 quota tests after removing sidebar session-cost calculation.
- Verified the screenshot's session has an underlying `$0.194405` API-equivalent estimate in token reports.
- Completed adversarial review with no remaining P0-P2 findings.
- Verified session `ses_05af1f93effeC45ds9MjbVFwf4` completed successfully with Kimi K3 variant `medium` and recorded reasoning tokens.
- Implemented the selected built-in `spent` behavior for Codex and Kimi and verified effective model costs in fresh OpenCode processes.
- Fixed Kimi API-equivalent pricing aliases; the mixed-provider session now resolves to a complete `$0.1330364` estimate.
- Added Codex fast-alias pricing and applied configured snapshot selection before native model costs materialize.
- Removed the duplicate API-equivalent row from detailed and compact session-token UI while preserving `/tokens_*` cost reports and native Context `spent`.
- Cleared saved Kimi K3 and Grok 4.5 effort choices so their next model selections explicitly open the effort picker.
- Passed the final quota build, 1,240-test suite, targeted Prettier and Markdownlint checks, and `check-docs` validation.
- Committed and pushed the quota implementation to `shepherdjerred/opencode-quota` as `c356aef` (`fix: restore OAuth model pricing`).
- Completed final adversarial review with no P0-P2 findings.
- Passed the final `bun run verify -- --affected` in the monorepo: 21 of 21 tasks successful.

### Remaining

- Quit and restart OpenCode so the running TUI loads the rebuilt local plugin and rereads model-selection state.

### Caveats

- Subscription-backed usage has no reliable per-session billed-dollar attribution. API-equivalent and provider-credit estimates are the useful best-effort substitutes.
- Anthropic, ChatGPT, Kimi, and Grok subscription endpoints used by the plugins are private or semi-private contracts and can change independently of OpenCode.
- Exact plan entitlements remain account-specific even when a model appears in a provider catalog.
- The exact reason `k3-256k` is absent from the effective OpenCode catalog remains unknown.
- Native Context `spent` represents public API-list-price equivalents for new Codex, Kimi, and Grok messages; it is not an actual subscription charge. The quota panel no longer duplicates this value.
- Historical Codex and Kimi messages retain their already-persisted zero native cost; only new messages use restored native prices.
- After `/pricing_refresh`, OpenCode must restart to rematerialize native model costs; quota reports can use refreshed pricing immediately.
- Kimi's discovery endpoint advertises `low/high/max`, but OpenCode's synthesized `medium` K3 variant was accepted successfully by the live provider.
- OpenCode remembers a selected effort per model. Kimi and Grok will prompt on their next selection after the state reset, then stop prompting once the new effort is saved; always prompting would require an OpenCode TUI change.
