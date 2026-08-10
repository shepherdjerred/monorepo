---
id: plan-2026-08-09-macos-ai-subscription-tracker
type: plan
status: in-progress
board: false
---

# Brim: Native macOS AI Subscription Tracker

Build a release-quality `packages/macos-ai-subscription-tracker` Swift package
for Claude Code, Codex, Kimi Code/K3, and Grok subscription quota monitoring.
The package is split into a testable `QuotaBarCore` library and a thin SwiftUI
`MenuBarExtra` executable. It uses typed local credential discovery,
provider-isolated adapters, five-minute polling, observable JSON snapshot
persistence, and a settings window.

Claude and Codex adapters port the useful patterns from the frozen archived
Glance app without modifying it. Kimi and Grok use private authenticated
subscription surfaces with strict fixture-backed decoding and explicit
partial, stale, and unsupported states. No API billing cards, full dashboard,
history charts, notifications, or automatic updates are included in v1.

## Core contracts

- `UsageSnapshot`, `UsageWindow`, `WindowKind`, and `Reset` are
  provider-independent. Percentages, durations, identifiers, reset dates, and
  paired absolute values are validated before becoming domain objects.
- Claude preserves dynamic and model-scoped windows. Fable is a real window
  when returned and otherwise a clearly labeled policy entitlement.
- Codex keeps every returned quota window. It classifies only from duration
  metadata and uses `providerDefined` when duration is absent. Banked resets are
  filtered by expiration, sorted, and carry a separate reset-surface error.
- Kimi computes usage from `used / limit` or
  `(limit - remaining) / limit`; absolute remaining counts are never rendered
  as percentages.
- Grok decodes identity, monthly billing, weekly credits, products, and extra
  credits as independent typed surfaces. One valid surface remains visible with
  a warning when another fails; an absent percentage remains unknown.
- A 401 reloads credentials once. A 429, network failure, or bounded timeout
  retains the last successful snapshot as stale. Malformed data fails visibly.
- `QuotaOverview` derives the compact summary, provider ordering, active reset
  presentation, and relative timestamps without changing provider snapshots.

## Credentials and persistence

Manual overrides live in the macOS login Keychain. Claude, Codex, Kimi, and
OpenCode stores use exact typed token fields rather than recursive string
discovery. OpenCode is read-only: Brim does not rotate or rewrite Kimi/Grok
OAuth state. Expired OpenCode tokens direct the user back to OpenCode.

Only successful current snapshots are persisted under Application Support.
Cache reads and writes throw; corrupt and write-failed states stay visible.
Loaded cache entries are always marked stale until a provider refresh succeeds.
Disabled providers are excluded from aggregate status, whose precedence is
critical, unavailable/stale, warning, then healthy.

The personal spend reminder records four separate subscriptions: $200 for
Claude Code, $200 for Codex, $40 for Kimi, and $30 for Grok, totaling
$470/month. These are static personal reminders rather than provider billing
data.

## App and repository integration

The package is registered as `@shepherdjerred/quotabar` in the root Bun
workspace. Buildkite's Linux graph runs only strict SwiftLint through
`lint:swift`; macOS-only work uses `build:macos`, `test:macos`, `bundle:macos`,
and `verify:macos`. No macOS CI lane is added in this pass.

`bundle:macos` creates `dist/QuotaBar.app` with identifier
`com.sjerred.QuotaBar`, `LSUIElement`, a generated `.icns`, the SwiftPM resource
bundle, and ad-hoc or optional Developer ID signing. `install:macos` explicitly
targets `/Applications/QuotaBar.app`. Launch at login reads
`SMAppService.mainApp.status`; failed registration rolls back visibly and
approval-required state links to Login Items settings.

`project.yml` generates a native Xcode application target around the same
local `QuotaBarCore` package. It enables automatic signing for the owner's
development team and hardened runtime. The account-independent macOS gate
compiles this target with signing disabled; after the owner signs into Xcode,
the same target archives with automatic signing and uses Organizer's Developer
ID upload flow or the equivalent explicit package commands for notarization and
ticket stapling. The release path verifies the Developer ID authority, secure
timestamp, hardened runtime, stapled ticket, strict signature, and Gatekeeper
acceptance before installing. Apple credentials and private signing material
never enter the repository.

The durable operator procedure, artifact definitions, and signing failure
diagnostics live in the
[Brim signing and notarization runbook](../guides/2026-08-09_quotabar-signing-notarization.md).

The compact popover keeps its header, summary, subscription footer, and actions
fixed while unboxed provider sections scroll within a measured 220–460 point
viewport. Providers sort by their tightest current quota; each quota window and
Codex reset expiration fits on a concise row. Healthy values are neutral, while
orange and red are reserved for warning and critical pressure. Help uses native
hover text and VoiceOver values rather than nested popovers. Provider logos are
bundled with provenance and trademark attribution.

An equal-width `API & routers` segment remains visible but disabled so the
future information architecture is explicit. This version adds no API key,
router, API spend, balance, or developer rate-limit behavior.

## Verification

- Strict SwiftLint and Swift format lint pass with zero violations.
- Warnings-as-errors tests cover domain thresholds, provider fixtures,
  transport behavior, one-reload authentication, read-only OpenCode discovery,
  persistence, polling, launch-at-login, partial failures, overview ordering,
  summary precedence, compact time formatting, and reset presentation.
- `QuotaBarCore` enforces at least 80% line coverage, excluding SwiftUI
  composition and generated resource accessors.
- Release build, generated Xcode app target, `plutil`, expected resources, and
  strict code-signature checks pass for the generated app bundle.
- Final human acceptance launches the installed app, checks Settings and
  launch-at-login status, and compares all four providers' displayed values,
  reset times, and Codex reset expirations with their Usage pages. Compilation
  and fixtures alone do not satisfy this final item.
