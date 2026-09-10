# Brim

Brim is a personal macOS menu-bar app for monitoring AI subscription
quotas. It targets Claude Code, Codex, Google Antigravity, Cursor, Grok, and
Kimi Code by default.

Brim is the product name; QuotaBar is the Xcode target, bundle id
(`com.sjerred.QuotaBar`), and workspace package id
(`@shepherdjerred/quotabar`).

The menu bar also shows the configured personal subscription spend: $200/month
each for Claude Code and Codex, $20/month each for Google AI Pro and Cursor
Pro, $30/month for Grok, and $40/month for Kimi Code ($510/month total). This
is a reminder, not provider billing data.

The compact subscription view sorts providers by their tightest current quota,
keeps each quota and reset on one line, and uses pressure colors only for low or
critical remaining usage. Cached values remain visible but dimmed and stale.
The `API & routers` segment reports OpenRouter credits plus OpenAI and Anthropic
organization API spend for the current local month.

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
hard Buildkite lane named `quotabar-macos` waits for Linux `verify` and then
runs the complete `verify:macos` suite on the serial native `macos` queue for
both PRs and `main`. Developer ID export, notarization, installation, and
release remain explicit operator-only workflows.

## Credentials

Brim reads existing local OAuth credentials or accepts an optional token
override in Settings for Claude, Codex, Kimi, and Grok. Overrides are stored in
the macOS login Keychain, take precedence over local discovery, and can be
removed from the same screen. Antigravity and Cursor deliberately do not accept
manual overrides: they reuse their respective local application sign-ins.
Brim does not log tokens or include them in its JSON usage cache. It stores only
local historical quota samples (provider/window metadata, percentages, reset
times, and timestamps) for up to 30 days so it can render the History graph.

Claude and Codex use their typed local credential formats. Grok reads grok CLI
`auth.json` (including a relocated `GROK_HOME`) plus an optional Keychain
override. It does not read OpenCode Grok or xAI tokens. Kimi Code reads its
`KIMI_CODE_HOME` credential directory (default `~/.kimi-code`) and can also
read typed OAuth entries from OpenCode. OpenCode remains the sole owner and
writer of those Kimi OAuth token chains: Brim never rotates, refreshes, or
rewrites OpenCode files or its credential database. An expired or rejected
Kimi token instructs the user to refresh it through OpenCode. An expired or
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
Claude/GPT five-hour and weekly buckets. It never reads, copies, refreshes,
logs, or persists Google's token. Gemini CLI and Code Assist quotas are outside
this integration. See the
[Antigravity usage command](https://antigravity.google/docs/cli/commands/usage).

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
optional Keychain override. It does not read OpenCode Grok or xAI tokens.
It requests Grok's identity, monthly billing, and credit surfaces, plus the
remaining-reset RPC read-only. It displays subscription usage and credits, not
xAI developer API rate limits. Banked extra resets are shown individually with
their expiration dates; Brim never redeems or consumes them. This is a
private provider contract: schema drift and authentication failures remain
explicit, and Brim never substitutes zero usage. Brim never refreshes or
rewrites grok CLI credentials; `grok login` remains the owner of that session.

Kimi Code reads its local OAuth credential directory, including a relocated
`KIMI_CODE_HOME`, and can also read typed OpenCode OAuth entries. It displays
the coding subscription surface, not a Kimi Open Platform API key. This is a
private provider contract: schema drift and authentication failures remain
explicit, and Brim never substitutes zero usage.

Codex also reads the authenticated reset-credit surface read-only. Available
banked resets are shown individually with their expiration dates; Brim does
not redeem or consume them.

### API platform reporting

The API view accepts a privileged admin or management key per platform, entered
in Settings and stored in a dedicated login-Keychain account. Brim uses each
key only for read-only billing requests:

- OpenRouter Management API key: credits remaining and current-month API-key
  spend, including estimated BYOK, across every workspace.
- OpenAI Admin API key: organization Costs API spend for the current local
  calendar month. This is not ChatGPT subscription usage.
- Anthropic Admin API key: organization Cost Report spend for the current
  local calendar month. This is not Claude Pro or Claude Code subscription
  usage.

Brim only performs read-only requests. It does not create, update, disable, or
delete provider keys. Each platform projects month-end spend from the current
Mac-local calendar pace. Chatroom, Fusion, and other unlisted billing products
stay out of this slice.

Provider contracts are isolated in focused files under `Sources/QuotaBarCore`.
Claude and Codex endpoints are authenticated subscription web surfaces;
Antigravity uses its CLI contract; Cursor uses the unsupported personal-client
contract described above. Grok and Kimi use private subscription quota
surfaces. Provider response changes produce an
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
times, and Codex/Grok banked reset expirations with each provider's own Usage
screen.

The frozen `sandbox/archive/glance` app is reference material only; this app is
implemented as a separate package so the archived tree remains unchanged.
