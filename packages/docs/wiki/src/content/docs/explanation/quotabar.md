---
title: About Brim
description: Why AI subscription quotas belong in a compact native menu-bar app with explicit provider boundaries.
sidebar:
  order: 7
---

Brim keeps subscription usage visible without turning provider-specific web
usage pages into a dashboard. Claude Code, Codex, Google Antigravity, and Cursor
are its standard providers; Kimi Code and Grok remain hidden legacy providers.
The authenticated HTTP providers use
[typed credential discovery](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/Credentials.swift).
Its [provider-independent model](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/Domain.swift)
marks cached or failed data stale instead of current.

```mermaid
flowchart LR
  accTitle: Brim quota flow
  accDescr: Provider-owned local sign-ins feed isolated adapters; validated usage snapshots are persisted and rendered as compact menu-bar sections.

  C[Local credentials or Keychain] --> A[Authenticated HTTP adapters]
  G[Signed-in Antigravity CLI] --> A
  S[Cursor local session] --> A
  A --> V[Validated UsageSnapshot]
  V --> P[(Application Support cache)]
  V --> U[MenuBarExtra popover]
  P -->|launch cache marked stale| U
```

## Boundaries

The subscription side of the app tracks quota only. It does not show provider
API rate cards, notifications, or a full usage dashboard. Its separate API view
reports configured OpenRouter usage, while local quota samples power the
subscription History graph.
The popover includes a personal subscription-spend reminder: $200/month each
for Claude Code and Codex plus $20/month each for Google AI Pro and Cursor Pro
($440/month standard total). Hidden legacy providers add Kimi Code at $40/month
and Grok at $30/month when enabled; these figures are reminders, not provider
billing data.
The reminder values live in the
[subscription plan model](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/Domain.swift).

The subscription view surfaces the tightest actionable quota first and sorts
provider sections by current remaining usage. Quota windows and Codex reset
expirations use compact rows; healthy values stay neutral while orange and red
are reserved for pressure. Policy-only Fable data, stale snapshots, unknown
percentages, and provider errors remain explicit without invented progress.
The `API & routers` segment is separate from these subscription quotas.
These choices are derived by the
[quota overview model](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/QuotaOverview.swift)
and rendered by the
[menu-bar view](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBar/MenuBarView.swift).

Claude and Codex use private authenticated subscription usage surfaces. Claude
preserves additive model-scoped windows when the account returns them; Fable is
shown as a policy-only row when no independent counter is exposed. Codex labels
windows from returned duration and reset metadata, so a missing five-hour
window is not invented. It also reads the reset-credit surface read-only and
shows each available banked reset with its expiration; Brim never redeems a
reset.
The provider-specific behavior is isolated in the
[Claude adapter](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/ClaudeCodeProvider.swift)
and [Codex adapter](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/CodexProvider.swift).

Google means Antigravity under the user's Google AI Pro subscription. Brim
asks the already signed-in `agy` CLI for its zero-turn `/usage` result and
displays the Gemini and Claude/GPT five-hour and weekly pools. The CLI remains
the token owner: Brim never reads, copies, refreshes, logs, or persists the
Google token. Gemini CLI and Code Assist quotas are deliberately outside this
boundary. The contract is documented by the
[Antigravity usage command](https://antigravity.google/docs/cli/commands/usage).

Cursor means the active local Cursor Pro session. Brim reads only the local
`cursorAuth/accessToken` value and requests the current billing period's Cursor
Models and Other Models pools. Cursor's documented
[Admin API](https://cursor.com/docs/account/teams/admin-api) is designed for
teams and does not provide this personal subscription view, so this adapter is
explicitly an unsupported private client contract. Authentication failures,
timeouts, and changed schemas become unavailable or stale data rather than
fabricated zero usage. Cursor team analytics and on-demand spend reporting stay
out of scope; the two subscription pools are described in Cursor's
[usage-limit guide](https://prod.cursor.com/help/models-and-usage/usage-limits).

Kimi Code reads its local OAuth credential directory, including a relocated
`KIMI_CODE_HOME`, and keeps Kimi Code separate from Moonshot Open Platform API
keys. Kimi and Grok may also read typed OAuth entries owned by OpenCode.
Brim never refreshes or rewrites OpenCode's credential chain; expired
credentials must be refreshed through OpenCode. Grok reads subscription usage
and credit surfaces, not xAI developer API limits. Kimi and Grok responses are
private contracts: malformed or changed responses become unavailable/stale
states and are covered by local fixtures.
Those boundaries are implemented by the
[Kimi adapter](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/KimiProvider.swift),
[Grok adapter](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/GrokProvider.swift),
and read-only [credential store](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/Credentials.swift).

## Runtime behavior

All enabled providers refresh in parallel every five minutes by default, with
bounded request and provider timeouts. A 401 reloads local credentials once. A
429 or network error retains the last successful windows and marks them stale.
Independent Codex/Grok surfaces may preserve valid partial data with a warning.
Successful snapshots are stored as JSON under the user's Brim Application
Support directory; corrupt and failed writes are visible, and loading the cache
always marks it stale until a fresh response arrives.
See the [polling coordinator](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/QuotaBarModel.swift),
[HTTP client](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/Networking.swift),
and [snapshot store](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/Persistence.swift).

The menu-bar symbol and text status use the lowest remaining quota: healthy
above 20%, warning from 5% through 20%, critical below 5%, and unavailable for
stale or unauthenticated data. Settings controls provider enablement, polling,
launch at login, optional credentials for supported providers, and links to the
provider usage pages. Optional overrides are stored in the macOS Keychain and
are not included in the snapshot cache. Antigravity and Cursor cannot be
overridden because their respective local applications own those sign-ins;
Kimi Code and Grok fields are for subscription credentials, not their developer
API keys. Launch at login reflects the
installed app's real `SMAppService` state and reports approval or registration
failures instead of storing a hopeful boolean.
The controls are defined by [SettingsView](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBar/SettingsView.swift)
and the [launch-at-login controller](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/LaunchAtLogin.swift).

Brim's app icon is a committed Icon Composer document with separate background,
ring, and quota-wave layers. Xcode uses the document for native macOS icon
rendering across appearance modes; the manual SwiftPM bundle renders its
Default appearance into `Brim.icns` with Icon Composer's `ictool` for older
macOS compatibility. The menu-bar status glyphs remain separate template
assets because they communicate live quota state rather than app identity.

## Release boundary

The root Linux verification graph runs strict SwiftLint. Native build, test,
80% core coverage, Xcode-project compilation, app bundling, signing, and smoke
checks run locally through
`cd packages/macos-ai-subscription-tracker && bun run verify:macos`; no macOS
CI lane exists yet.
The ordinary local bundle is ad-hoc signed. A generated Xcode application
target links the same core package and enables automatic signing plus hardened
runtime; direct distribution goes through Xcode Organizer's Developer ID and
notarization workflow or equivalent explicit package commands. A release is
installable only after its Developer ID authority, secure timestamp, stapled
ticket, strict signature, and Gatekeeper acceptance all pass. Apple credentials
and private signing keys remain outside the repository. Passing fixtures
validates known response shapes but does not replace comparing every enabled
provider with its own live usage view before release.
The native release gate is defined by the
[package scripts](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/package.json)
and [Xcode project specification](https://github.com/shepherdjerred/monorepo/blob/231bac375d228b685e12308a1d02d243cb3d1481/packages/macos-ai-subscription-tracker/project.yml).

## Related

- [Monorepo source](https://github.com/shepherdjerred/monorepo) —
  `packages/macos-ai-subscription-tracker`
