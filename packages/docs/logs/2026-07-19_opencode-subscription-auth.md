# OpenCode Subscription Authentication

## Status

Partially Complete

Configured OpenCode to preserve provider API-key environment variables for other tools while preventing the standard Fish `opencode` command from receiving them. Added the version-pinned Kimi Code OAuth bridge; Codex OAuth was already configured. Anthropic was intentionally omitted because its terms prohibit using Claude Pro/Max through OpenCode, and Google was omitted after its bridge documented a policy-violation risk.

## Session Log — 2026-07-19

### Done

- Added the `opencode` Fish wrapper to the live config and chezmoi template; it unsets `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and `OPENAI_API_KEY` only for OpenCode.
- Added the pinned `opencode-kimi-code-auth@0.1.7` plugin to `~/.config/opencode/opencode.jsonc` and its chezmoi source.
- Confirmed the user completed `kimi login`, creating the Kimi Code subscription credential used by the OpenCode bridge.
- Added `~/.kimi -> ~/.kimi-code` compatibility symlink because the bridge reads Kimi's former credential path; verified the bridge recognizes the current Kimi Code OAuth credential without exposing or copying it.
- Replaced the incompatible legacy bridge with `opencode-kimi-full@1.4.0`, which uses Kimi's dedicated coding endpoint, device OAuth, model discovery, and subscription request headers.
- Removed the generic `moonshotai` credential after logs proved it sent an invalid API-key request instead of the Kimi subscription flow.
- Confirmed `fish -c 'opencode providers list'` exposes only the existing OpenAI OAuth credential, and confirmed resolved OpenCode config and Fish syntax.
- Uninstalled Homebrew's `pi-coding-agent`, which also auto-removed its unused `node@24` dependency; deleted `~/.pi` OAuth state, sessions, extensions, and downloaded packages.
- Removed the Pi chezmoi source and all six unmanaged Plannotator skills under `~/.agents/skills` and `~/.claude/skills`.
- Removed all three global OpenCode Plannotator commands and verified OpenCode now resolves with an empty command set.

### Remaining

- Restart OpenCode, run `opencode auth login -p kimi-for-coding-oauth`, and complete the Kimi device-code approval. Then select `kimi-for-coding-oauth/kimi-for-coding` and verify a request.

### Caveats

- Invoking `/opt/homebrew/bin/opencode` directly bypasses the Fish wrapper. Use `opencode` from Fish.
- Anthropic and Google were deliberately not configured: Anthropic prohibits Claude Pro/Max use in OpenCode; the Google OAuth bridge documents policy-violation and account-restriction risk.
- Pi and Plannotator are fully removed from scanned user config, cache, package, skill, and command locations.
- The installed Kimi bridge uses a legacy `~/.kimi` path, which is mapped to the current `~/.kimi-code` state directory with a symlink.
- The generic Moonshot AI provider is intentionally unauthenticated to prevent API-key routing; use only `kimi-for-coding-oauth/kimi-for-coding`.

## Session Log — 2026-07-19

### Done

- Reviewed and committed the OpenCode migration, its supporting docs, and the removal of retired Pi configuration.

### Remaining

- Complete the Kimi device-code authorization and verify a request as described above.

### Caveats

- The commit includes other current-session documentation and follow-up artifacts already present in the worktree.
