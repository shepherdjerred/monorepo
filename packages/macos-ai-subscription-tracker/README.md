# Brim

Brim is a personal macOS menu-bar app for monitoring AI subscription
quotas. It targets Claude Code and Codex by default. Kimi Code and Grok remain
available only through the Advanced legacy-provider setting.

Brim is the product name; QuotaBar is the Xcode target, bundle id
(`com.sjerred.QuotaBar`), and workspace package id
(`@shepherdjerred/quotabar`).

The menu bar also shows the configured personal subscription spend: $200/month
for Claude Code and $200/month for Codex ($400/month total). Enabling legacy
providers adds Kimi Code ($40/month) and Grok ($30/month). This is a reminder,
not provider billing data.

The compact subscription view sorts providers by their tightest current quota,
keeps each quota and reset on one line, and uses pressure colors only for low or
critical remaining usage. Cached values remain visible but dimmed and stale.
The `API & routers` segment currently reports OpenRouter credits and API-key
spend across all workspaces.

## Build and install

```bash
bun run verify:macos
bun run bundle:macos
bun run install:macos
```

`verify:macos` runs Swift format lint, strict SwiftLint, warnings-as-errors
tests, the 80% `QuotaBarCore` coverage gate, a release build, app bundling,
`plutil`, asset checks, and strict code-signature verification. The bundle is
written to `dist/QuotaBar.app` and ad-hoc signed by default. Set
`QUOTABAR_CODESIGN_IDENTITY` to a Developer ID Application identity when one is
available.

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

The Linux repository gate runs only the portable `lint:swift` task. Native
Xcode-project generation, build, test, coverage, bundle, and smoke verification remain required local
macOS release checks; this package does not add a macOS CI lane.

## Credentials

Brim reads existing local OAuth credentials or accepts an optional token
override in Settings. Overrides are stored in the macOS login Keychain, take
precedence over local discovery, and can be removed from the same screen.
Brim does not log tokens or include them in its JSON usage cache. It stores only
local historical quota samples (provider/window metadata, percentages, reset
times, and timestamps) for up to 30 days so it can render the History graph.

Claude and Codex use their typed local credential formats. When the legacy
provider setting is enabled, Kimi Code reads its `KIMI_CODE_HOME` credential
directory (default `~/.kimi-code`). Kimi and Grok
can also read typed OAuth entries from OpenCode. OpenCode remains the sole owner
and writer of those OAuth token chains: Brim never rotates, refreshes, or
rewrites OpenCode files or its credential database. An expired or rejected
Kimi/Grok token instructs the user to refresh it through OpenCode.

The Kimi and Grok subscription quota responses are private provider contracts,
not stable public APIs. Their adapters validate responses and show an explicit
unavailable/stale state when a provider changes shape. Claude and Codex use
their authenticated subscription usage surfaces; Kimi Code uses its coding
subscription surface, not a Kimi Open Platform API key; Grok uses subscription
usage and credits, not xAI developer API rate limits. Non-OpenRouter API billing
cards and developer API rate limits remain outside the v1 scope.

Codex also reads the authenticated reset-credit surface read-only. Available
banked resets are shown individually with their expiration dates; Brim does
not redeem or consume them.

### OpenRouter API reporting

The API view requires an OpenRouter Management API key entered manually in
Settings. Brim stores this key in a dedicated login-Keychain entry and only
performs read-only requests for credits, workspaces, and API-key usage. Brim
does not create, update, disable, or delete OpenRouter keys.

The view shows credits remaining, monthly API-key spend, and a projected
month-end spend. Monthly spend is the sum of OpenRouter's current-month
usage_monthly and estimated byok_usage_monthly values across every workspace
and API key, including disabled keys. The projection uses the current Mac-local
calendar pace against OpenRouter's authoritative monthly usage period. Chatroom
and Fusion activity is outside this first API-key reporting slice.

Provider contracts are isolated in focused files under `Sources/QuotaBarCore`.
Claude and Codex endpoints are authenticated subscription web surfaces. Legacy
Kimi and Grok support uses private subscription quota surfaces and is disabled
by default because those contracts may change without notice. When enabled,
provider response changes produce an explicit unavailable, partial, or stale
state rather than a fabricated zero.

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
times, and Codex reset expirations with each provider's own Usage screen.

The frozen `sandbox/archive/glance` app is reference material only; this app is
implemented as a separate package so the archived tree remains unchanged.
