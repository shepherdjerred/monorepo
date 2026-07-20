# OpenCode Subscription Authentication

## Status

Complete

Configured OpenCode to preserve provider API-key environment variables for other tools while preventing the standard Fish `opencode` command from receiving them. Added the version-pinned Kimi Code OAuth bridge; Codex OAuth was already configured. Anthropic was intentionally omitted because its terms prohibit using Claude Pro/Max through OpenCode, and Google was omitted after its bridge documented a policy-violation risk.

## Session Log — 2026-07-19 (Kimi and Pi Migration)

### Done

- Added the `opencode` Fish wrapper to the live config and chezmoi template; it unsets `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and `OPENAI_API_KEY` only for OpenCode.
- Added the pinned `opencode-kimi-code-auth@0.1.7` plugin to `~/.config/opencode/opencode.jsonc` and its chezmoi source.
- Confirmed the user completed `kimi login`, creating the Kimi Code subscription credential used by the OpenCode bridge.
- Added `~/.kimi -> ~/.kimi-code` compatibility symlink because the bridge reads Kimi's former credential path; verified the bridge recognizes the current Kimi Code OAuth credential without exposing or copying it.
- Replaced the incompatible legacy bridge with `opencode-kimi-full@1.4.0`, which uses Kimi's dedicated coding endpoint, device OAuth, model discovery, and subscription request headers.
- Removed the generic `moonshotai` credential after logs proved it sent an invalid API-key request instead of the Kimi subscription flow.
- Added K2.7 Coding Highspeed and K3 aliases under the dedicated provider using the official Kimi CLI's configured wire model IDs; verified all three aliases appear in OpenCode's model picker.
- Verified an end-to-end K3 response in OpenCode through `Kimi For Coding (OAuth)`; the OpenCode UI identified the selected model as K3 and reported no API spend.
- Confirmed the persisted auth store contains only OpenAI OAuth and `kimi-for-coding-oauth` for OpenCode, and confirmed the K3 session log uses `providerID=kimi-for-coding-oauth`.
- Confirmed the OpenCode chezmoi source is tracked on `main` in `02177c0e5`; no PR is needed for the global configuration.
- Confirmed `fish -c 'opencode providers list'` exposes only the existing OpenAI OAuth credential, and confirmed resolved OpenCode config and Fish syntax.
- Uninstalled Homebrew's `pi-coding-agent`, which also auto-removed its unused `node@24` dependency; deleted `~/.pi` OAuth state, sessions, extensions, and downloaded packages.
- Removed the Pi chezmoi source and all six unmanaged Plannotator skills under `~/.agents/skills` and `~/.claude/skills`.
- Removed all three global OpenCode Plannotator commands and verified OpenCode now resolves with an empty command set.
- Reviewed and committed the OpenCode migration, its supporting docs, and the removal of retired Pi configuration.

### Remaining

- None.

### Caveats

- Invoking `/opt/homebrew/bin/opencode` directly bypasses the Fish wrapper. Use `opencode` from Fish.
- Anthropic and Google were deliberately not configured: Anthropic prohibits Claude Pro/Max use in OpenCode; the Google OAuth bridge documents policy-violation and account-restriction risk.
- Pi and Plannotator are fully removed from scanned user config, cache, package, skill, and command locations.
- The installed Kimi bridge uses a legacy `~/.kimi` path, which is mapped to the current `~/.kimi-code` state directory with a symlink.
- The generic Moonshot AI provider is intentionally unauthenticated to prevent API-key routing; use only `kimi-for-coding-oauth/kimi-for-coding`.
- OAuth tokens and the `~/.kimi -> ~/.kimi-code` compatibility symlink remain local machine state and are deliberately not tracked.

## Session Log — 2026-07-19 (xAI Research)

### Done

- Confirmed OpenCode supports xAI authentication through SuperGrok browser OAuth, SuperGrok device-code OAuth for headless hosts, and separately billed xAI API keys.
- Checked current xAI API pricing and documented that API-key usage is distinct from subscription OAuth.

### Remaining

- None.

### Caveats

- Subscription plan availability, included models, quotas, and checkout prices vary by account and region; verify the exact entitlement in the xAI or X purchase flow before subscribing.

## Session Log — 2026-07-19 (xAI OAuth)

### Done

- Connected the user's SuperGrok subscription through OpenCode's xAI OAuth flow.
- Verified `opencode auth list` reports the xAI OAuth credential.
- Verified model discovery lists Grok 4.3, 4.5, 4.20 reasoning/non-reasoning/multi-agent, Grok Build, and Grok Imagine models.
- Verified the chezmoi-managed global OpenCode configuration remains in sync; OAuth credentials are local state and are not added to dotfiles.

### Remaining

- None.

### Caveats

- OAuth is refreshed automatically by OpenCode; availability and limits are governed by the SuperGrok subscription.
