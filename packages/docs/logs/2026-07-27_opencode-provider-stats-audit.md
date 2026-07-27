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
- The quota plugin calculates API-equivalent dollars, but only in `/tokens_*` reports. It does not add that estimate to the sidebar's Context section or its own session-token block.
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

Calling the estimate `spent` would be incorrect. The custom sidebar should add `API eq. $X` and an incomplete-pricing marker while leaving native OpenCode untouched.

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

- Renders `API eq. $X.XX` beneath the sidebar's session token summary without calling it billed or spent.
- Marks estimates partial when any saved message cannot be mapped to public pricing.
- Preserves and applies Models.dev context-price tiers per message, including cached prompt tokens when selecting a tier.
- Retains historical pricing keys across snapshot refreshes so saved Cursor/Copilot usage remains priceable.
- Prefers isolated OpenCode package-cache Kimi companions before the development link, preventing tests from reaching the live account.
- Keeps `partial` visible in narrow sidebars and renders positive sub-cent estimates as `<$0.01` instead of `$0.00`.

The screenshot's `Test message` session (`ses_05b1104adffeXaLIuzH0Lx6gtU`) was verified against the built `dist` output: 24K new input, 95K cached input, 453 output, and `API eq. $0.19` (`$0.194405` before display rounding).

## Remaining Fix Order

1. Map all Kimi OAuth provider/model IDs to current Moonshot pricing IDs and add live-history regression tests.
2. Render all provider-native limit families and balances, preserving unknown named windows instead of dropping them.
3. Add refresh-safe OpenAI and xAI quota clients using the same single-flight/persist pattern as Kimi.
4. Add `k3-256k` to static config, investigate why discovery does not expose it, and merge discovered variants into the effective model config.
5. Record pricing snapshot timestamp/source in reports and optionally preserve per-message native list-price estimates for historical comparison.

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
- Implemented sidebar API-equivalent session cost, context-tier pricing, historical snapshot retention, and Kimi test isolation in `~/git/opencode-quota`.
- Verified TypeScript, the production build, and all 1,234 quota tests.
- Verified the screenshot's session renders `API eq. $0.19` from the built plugin.
- Completed adversarial review with no remaining P0-P2 findings.
- Verified session `ses_05af1f93effeC45ds9MjbVFwf4` completed successfully with Kimi K3 variant `medium` and recorded reasoning tokens.

### Remaining

- Quit and restart OpenCode so the running TUI loads the rebuilt local plugin.

### Caveats

- Subscription-backed usage has no reliable per-session billed-dollar attribution. API-equivalent and provider-credit estimates are the useful best-effort substitutes.
- Anthropic, ChatGPT, Kimi, and Grok subscription endpoints used by the plugins are private or semi-private contracts and can change independently of OpenCode.
- Exact plan entitlements remain account-specific even when a model appears in a provider catalog.
- The exact reason `k3-256k` is absent from the effective OpenCode catalog remains unknown.
- OpenCode's native Context row will continue to say `$0.00 spent` for subscription OAuth; the meaningful estimate appears in the plugin's session-token section as `API eq.`.
- Kimi's discovery endpoint advertises `low/high/max`, but OpenCode's synthesized `medium` K3 variant was accepted successfully by the live provider.
