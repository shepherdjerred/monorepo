# Brim

Brim is a personal macOS menu-bar app for monitoring AI subscription
quotas. It targets Claude Code, Codex, Google Antigravity, Cursor, Grok,
Kimi Code, and Meta Muse by default.

Brim is the product name; QuotaBar is the Xcode target, bundle id
(`com.sjerred.QuotaBar`), and workspace package id
(`@shepherdjerred/quotabar`).

The menu bar also shows the configured personal subscription spend: $200/month
each for Claude Code and Codex, $20/month each for Google AI Pro and Cursor
Pro, $30/month for Grok, $40/month for Kimi Code, and $15/month for Meta Muse
($525/month total). Cursor's own reported price replaces its entry when Cursor
returns one. This is a reminder, not provider billing data.

## Plans

Each provider row names the plan the account is on, read from the provider
rather than configured:

| Provider    | Source                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------- |
| Claude Code | `cedar_ember.event_props.tier` in the usage response (`claude_max_20x` shows as Max 20x) |
| Codex       | `plan_type` in the usage response                                                        |
| Cursor      | `DashboardService/GetPlanInfo`: `planName` and the monthly `price`                       |
| Grok        | `/v1/settings`: `subscription_tier_display`                                              |
| Kimi Code   | `/coding/v1/me`: `user_level_name`                                                       |
| Meta Muse   | the CLI's `allowance.tier`                                                               |
| Antigravity | Google Code Assist `loadCodeAssist`: `paidTier`, else `currentTier`                      |

Identifier-style names are made readable by one generic rule: split on
separators, drop the provider word, title-case. There is no rename table. The
plan is supplementary. A failed or unreadable plan request leaves the plan
unset, adds a "Plan unavailable" note, and never fails or stales the usage.
`brim --json` and the Herdr worktree dialog show the same plan.

The compact subscription view sorts providers by their tightest current quota,
keeps each quota and reset on one line, and uses pressure colors only for low or
critical remaining usage. Cached values remain visible but dimmed and stale.
Claude Code and Codex also show today's token total and an API list-price
estimate read from their local CLI logs. That caption is separate from the
quota percentage, the monthly admin invoice, and the API credit balance. A
missing log directory omits it. An unknown model still counts toward the token
total and drops the dollar amount for that day. When `brim sync pull` has
mirrored other machines into `~/.toolkit/brim-sync/mirror/`, a second
`All machines` line adds their usage for the same calendar day; see
[Sync agent history across machines](../docs/wiki/src/content/docs/how-to/sync-agent-history-across-machines.md).
The `API & routers` segment reports OpenAI and Anthropic organization API spend
for the current local month.

## Sessions window

**Browse sessions** in the menu-bar footer opens the Sessions window, a browser
for past agent sessions recorded by the toolkit history index:

- The sidebar filters by machine (This Mac plus each `brim sync` mirror),
  agent, and project, with each one's indexed session count, and opens
  Analytics.
- The session list shows the title, agent, machine, project, branch, last
  update, tokens, and estimated cost. The search field runs a full-text search
  within the sidebar selection and time range.
- A session's **Conversation** tab pages through its messages (200 at a time).
  Each tool call is collapsed under its tool name, with its **Output** rows
  collapsed inside it. **Usage** breaks its tokens down by type.
- **Analytics** charts daily cost and tokens, cost by model, agent, project,
  and machine, and the most-called tools for the selected time range.

A session's **Requests** tab lists the raw API requests `brim capture`
recorded for it (`/v1/captures?session=<id>`): each request's time, model,
status, duration, tokens including cache reads and writes, and a bar of how its
context splits into system, tools, history, and new bytes. Requests whose
inherited context was never captured, and non-`ok` statuses, are marked; Codex
warm-ups are dimmed and labelled.
Selecting one loads its detail (`/v1/captures/<id>`) into an inspector with the
full rebuilt context (system prompt, tools grouped by namespace with their
parameter schemas, messages), the response, and usage; a "New in this request"
view of what it added over the previous one; the body as sent, which for a
chained request leaves out the blocks it inherited, and the response JSON; and
a protobuf field dump when the body was protobuf. A session
with no captures says capture is off or was not used for it, and points to
`brim capture install` and the
[Capture raw agent requests](../docs/wiki/src/content/docs/how-to/capture-raw-agent-requests.md)
how-to.

A cost marked `≥` is a lower bound: the session used a model the price catalog
does not know. A `—` instead of tokens and cost means the agent's transcripts
record no usage at all, which is different from a session that cost nothing. Every read goes through the history daemon's read-only `/v1` API
on `~/.toolkit/history/daemon.sock`; see the toolkit README's Read API section.
Brim never reads the index or transcripts itself. If the daemon is not running,
the window says so and shows `toolkit history daemon install`; a response that
does not match the `packages/toolkit/schemas/history-api-*.schema.json`
contracts is shown as a version mismatch. `QuotaBarCore/History` holds the
client, the decoders (tested against the shared fixtures in
`packages/toolkit/schemas/fixtures/`), and `SessionsModel`; the SwiftUI views
are in `Sources/QuotaBar/Sessions`.

## Build and install

```bash
bun run verify:macos
bun run bundle:macos
bun run install:macos
```

`verify:macos` runs Swift format lint, strict SwiftLint, warnings-as-errors
tests, the 80% `QuotaBarCore` coverage gate, a release build, app bundling,
`plutil`, asset checks, and strict code-signature verification. The bundle is
written to `dist/QuotaBar.app` and uses the installed Developer ID Application
identity automatically when exactly one is available. Set
`QUOTABAR_CODESIGN_IDENTITY` to an identity hash or name to select a specific
certificate; machines without a Developer ID identity continue to use an
ad-hoc local bundle.

`install:macos` is an explicit opt-in operation. It verifies the bundle, then
replaces the exact target `/Applications/Brim.app` and launches it. It removes
the legacy `/Applications/QuotaBar.app` installation during migration. Launch
at login requires this real app bundle; it does not claim success for a
`swift run` executable.

## App icon

`Resources/Brim.icon` is the app icon source of truth. It contains separate
background, quota-wave, and ring layers for Icon Composer's native macOS
rendering, including Default, Dark, and Mono appearances. The Xcode target uses
this document directly. The SwiftPM bundle path renders its Default macOS
appearance through Icon Composer's bundled `ictool` and creates `Brim.icns` as
the compatibility icon for older macOS releases.

Icon Composer is bundled with the selected Xcode installation and requires
macOS Tahoe 26.4 or later to edit. The app itself continues to target macOS
15.0; modern systems use the native `.icon` rendering while older systems use
the generated ICNS fallback.

## Xcode signing and notarization

The checked-in `project.yml` generates a native Xcode application project that
links the same local `QuotaBarCore` package used by SwiftPM. It enables
automatic signing for the paid team configured by `DEVELOPMENT_TEAM` (currently
`63ZAG7X889`) and hardened runtime without making an Apple account a
prerequisite for tests or the ad-hoc local bundle. `project.yml` is the single
source of truth for the signing team; the export plists inherit it from the
archive.

```bash
bun run xcode:open
```

Sign in under Xcode **Settings → Accounts** once, select the QuotaBar target,
and confirm **Automatically manage signing**. Xcode can then create the
development signing assets for normal Run builds. `bun run archive:macos`
creates `dist/QuotaBar.xcarchive` using that account; the equivalent UI command
is **Product → Archive**.

The complete direct-distribution workflow is:

```bash
bun run verify:macos
bun run archive:macos
bun run export:developer-id
bun run notarize:macos
bun run export:notarized
bun run verify:notarized
bun run install:notarized
```

`notarize:macos` intentionally creates a new submission to Apple's notary
service. `export:notarized` waits up to ten minutes for Xcode to receive and
staple the ticket. Verification requires strict `codesign`, a valid stapled
ticket, and Gatekeeper acceptance before the exact `/Applications/Brim.app`
target is replaced. Xcode Organizer's **Distribute App → Developer ID →
Upload** workflow remains the UI equivalent. Authentication stays in Xcode; no
Apple password, private key, or notarization credential belongs in the
repository.

See the
[Brim signing and notarization runbook](docs/signing-and-notarization.md)
for prerequisites, artifact definitions, verification evidence, versioning,
and troubleshooting.

The Linux repository gate runs the portable `lint:swift` task. A changed-path,
hard Woodpecker lane named `quotabar-macos` waits for Linux `verify` and then
runs the complete `verify:macos` suite on the serial native `macos` queue for
both PRs and `main`. Developer ID export, notarization, installation, and
release remain explicit operator-only workflows.

## Credentials

Brim reads existing local OAuth credentials or accepts an optional token
override in Settings for Claude, Codex, Kimi, and Grok. Overrides are stored in
the macOS login Keychain, take precedence over local discovery, and can be
removed from the same screen. Antigravity, Cursor, and Muse deliberately do not
accept manual overrides: they reuse their respective local application
sign-ins.
Brim does not log tokens or include them in its JSON usage cache. It stores only
local historical quota samples (provider/window metadata, percentages, reset
times, and timestamps) for up to 30 days so it can render the History graph.

Claude and Codex use their typed local credential formats. Grok reads grok CLI
`auth.json` (including a relocated `GROK_HOME`) plus an optional Keychain
override. Kimi Code reads its `KIMI_CODE_HOME` credential directory (default
`~/.kimi-code`); Brim never rotates, refreshes, or rewrites those files. An
expired or rejected Kimi token instructs the user to sign in again through
Kimi Code. An expired or
rejected Grok token instructs the user to sign in again with `grok login`.

Claude credentials are read through `/usr/bin/security` rather than the Security
framework. The
[Brim explanation page](../docs/wiki/src/content/docs/explanation/quotabar.md)
covers why.

The Kimi and Grok subscription quota responses are private provider contracts,
not stable public APIs. Their adapters validate responses and show an explicit
unavailable/stale state when a provider changes shape. Claude and Codex use
their authenticated subscription usage surfaces; Kimi Code uses its coding
subscription surface, not a Kimi Open Platform API key; Grok uses subscription
usage and credits, not xAI developer API rate limits. Other provider developer
API rate limits remain outside this scope.

Antigravity is invoked through the signed-in `agy` executable found on the
current process `PATH` or in standard Homebrew, local, and mise locations. Brim
runs `agy --print /usage --output-format json --print-timeout 20s`, requires a
successful zero-turn usage response, and displays the returned Gemini and
Claude/GPT five-hour and weekly buckets. Gemini CLI and Code Assist quotas are
outside this integration.

The plan is the one exception to leaving agy's sign-in alone, because only
Google's Code Assist API reports it. Brim reads the refresh token from
`~/.gemini/antigravity-cli/antigravity-oauth-token` and renews an access token
in memory. It uses the OAuth client built into the installed `agy` binary, read
at run time and cached until the binary changes, so no client secret is in this
repository. The access token is never written, and agy's files are never
modified. Google does not rotate the refresh token on renewal, so agy's own
session is unaffected. See the
[Antigravity usage command](https://antigravity.google/docs/cli/commands/usage).

Muse asks the signed-in `muse` CLI for its allowance. Brim locates `muse` on
the current process `PATH` or in standard Homebrew, local, and mise locations
and runs `muse usage --json`, displaying the returned rolling 5-hour and
weekly windows with their reset times. The CLI owns the OAuth credential and
its Keychain item: `muse` rewrites that item on every token refresh, which
resets its access-control list, so Brim reading the item directly turned
every poll during an active Muse session into a Keychain fight. Brim
therefore never reads, copies, refreshes, logs, or persists the Meta token. A
signed-out CLI — or an API-key login, which bills the Model API instead of
carrying a subscription — returns no allowance, so Brim reports Muse as
signed out. Over-quota percentages above 100 are shown as fully used with a
note.

Cursor reads only `cursorAuth/accessToken` from Cursor's local `state.vscdb`
and sends an empty Connect JSON request to Cursor's current-period usage
surface. It displays the monthly Cursor Models and Other Models pools with the
returned billing-cycle reset. This is intentionally an unsupported private
client contract because the documented
[Cursor Admin API](https://cursor.com/docs/account/teams/admin-api) is
team-oriented and does not expose the personal subscription view. Schema drift,
missing sign-in state, timeouts, and authentication failures remain explicit;
Brim never substitutes zero usage. Cursor team analytics and on-demand spend
reporting are outside this integration. Cursor documents the two pools in its
[usage-limit guide](https://prod.cursor.com/help/models-and-usage/usage-limits).

Grok reads grok CLI `auth.json` (default `~/.grok`, or `GROK_HOME`), or an
optional Keychain override.
It requests Grok's identity, monthly billing, and credit surfaces, plus the
remaining-reset RPC read-only. It displays subscription usage and credits, not
xAI developer API rate limits. A product row that repeats the shared credit
window's percentage and reset is omitted. Extra credits stay even when the
percentage matches. Banked extra resets are shown individually with
their expiration dates; Brim never redeems or consumes them. This is a
private provider contract: schema drift and authentication failures remain
explicit, and Brim never substitutes zero usage. Brim never refreshes or
rewrites grok CLI credentials; `grok login` remains the owner of that session.

Kimi Code reads its local OAuth credential directory, including a relocated
`KIMI_CODE_HOME`. It displays
every quota window the coding usage payload returns. That includes the rolling
`limits` array and the named `usages` pools, so a five-hour, daily, weekly, or
monthly window appears when the account returns it. Brim does not invent a
window the payload omits. The monthly code pool is part of the monthly total,
so while the two report the same usage and reset only Monthly is shown. A
five-hour `limits` row counts whole units of its limit, so it may differ from
the exact five-hour ratio by one unit; Brim then shows the exact ratio, and a
larger gap is a contradictory response. An unscoped top-level `usage` object is labeled
Subscription because the payload does not name its period. This is a
private provider contract: schema drift and authentication failures remain
explicit, and Brim never substitutes zero usage.

Claude's usage request also asks for saved usage-limit resets. Each unused
reset is shown with its expiration. Brim never redeems one. An inventory that
is ineligible for `no_grant` holds no resets and shows as No resets. A missing
inventory, or one ineligible for any other reason, is an explicit unavailable
reset state, not zero resets.
Codename meters such as Iguana Necktie are not shown. Codex also reads the
authenticated reset-credit surface read-only. Available banked resets are
shown individually with their expiration dates; Brim does not redeem or
consume them.

### API platform reporting

The API view accepts a privileged admin or management key per platform, entered
in Settings and stored in a dedicated login-Keychain account. Brim uses each
key only for read-only billing requests:

- OpenAI Admin API key: organization Costs API spend for the current local
  calendar month. This is not ChatGPT subscription usage.
- Anthropic Admin API key: organization Cost Report spend for the current
  local calendar month. This is not Claude Pro or Claude Code subscription
  usage.

Purchased and granted credit balances appear only when that Admin API returns
them. Each row uses the expiry on the payload. Brim does not invent a one-year
or billing-cycle date, and a missing or empty grant list is not shown as $0.
The current OpenAI and Anthropic Admin APIs return monthly spend and do not
return those balances, so each card says the balances were not returned.
Monthly spend and the projected month-end pace still publish.

Brim only performs read-only requests. It does not create, update, disable, or
delete provider keys. Each platform projects month-end spend from the current
Mac-local calendar pace. Chatroom, Fusion, and other unlisted billing products
stay out of this slice.

Provider contracts are isolated in focused files under `Sources/QuotaBarCore`.
Claude and Codex endpoints are authenticated subscription web surfaces;
Antigravity and Muse use their CLI contracts; Cursor uses the unsupported
personal-client contract described above.
Grok and Kimi use private subscription quota surfaces. Provider response
changes produce an
explicit unavailable, partial, or stale state rather than a fabricated zero.

## Development

```bash
bun run format
bun run lint:swift
bun run test:macos
bun run coverage:macos
bunx turbo run lint:swift --filter=@shepherdjerred/quotabar
```

Provider fixtures are shape-preserving samples with synthetic account values.
Passing fixtures proves decoder behavior, not current production correctness.
Release acceptance still compares all displayed windows, percentages, reset
times, and Claude/Codex/Grok banked reset expirations with each provider's own
Usage screen.

The frozen `sandbox/archive/glance` app is reference material only; this app is
implemented as a separate package so the archived tree remains unchanged.
