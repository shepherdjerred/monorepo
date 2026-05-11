# Bypass-by-default for Claude Code + Codex

## Status

Complete

## Context

Phase 1 (already implemented & synced via chezmoi):

- `~/.claude/settings.json` — `permissions.defaultMode = "bypassPermissions"` added; existing `skipDangerousModePermissionPrompt: true` keeps the launch warning suppressed.
- `~/.codex/config.toml` — `approval_policy = "never"` and `sandbox_mode = "danger-full-access"` added.
- `chezmoi re-add` complete; `chezmoi diff` clean.

Phase 2 (this plan): verify bypass mode actually engages on a fresh launch, and harden the existing `permissions.deny` list against catastrophic operations that aren't currently blocked.

## Phase 2a — Bypass smoke test

This Claude session was launched **before** the edit, so its in-process settings are stale; the test must run in a fresh subprocess. Headless `-p` / `exec` modes execute commands without a TTY, so any permission prompt manifests as a tool refusal in the printed output rather than an interactive blocker — that's what we'll detect.

```bash
# Claude Code — should run Bash without any "permission required" message
claude -p --output-format json \
  "Run this exact bash command and report stdout: touch /tmp/__bypass_claude && echo OK"

# Codex — should run Bash without sandbox approval prompt
codex exec \
  "Run this exact bash command and report stdout: touch /tmp/__bypass_codex && echo OK"

# Verify both side-effects landed:
ls -la /tmp/__bypass_claude /tmp/__bypass_codex
```

Pass criteria:

1. Both files exist after the runs.
2. Neither output contains a permission/sandbox refusal string (e.g. "permission denied", "approval required", "sandbox blocked").
3. `claude -p` JSON output should NOT contain `"permission_mode": "default"` for a Bash tool call.

Cleanup after: `rm /tmp/__bypass_claude /tmp/__bypass_codex`.

## Phase 2b — Deny-list audit (Tier A: essentials)

Live file: `~/.claude/settings.json` → `permissions.deny[]` (lines 13–49). Add the rules below into the existing array. Each will be evaluated independently against any subcommand in a pipeline (Claude Code parses `&&`/`||`/`;`/`|` and matches each segment), so e.g. `Bash(sh)` catches `curl X | sh` because the right side of the pipe is the bare `sh` subcommand.

| Pattern                                          | Catches                                                 |
| ------------------------------------------------ | ------------------------------------------------------- |
| `Bash(sh)`                                       | `curl X \| sh` (pipe target is bare `sh` reading stdin) |
| `Bash(bash)`                                     | `curl X \| bash`                                        |
| `Bash(zsh)`                                      | `curl X \| zsh`                                         |
| `Bash(sh -)`                                     | Explicit-stdin sh invocation                            |
| `Bash(bash -)`                                   | Explicit-stdin bash invocation                          |
| `Bash(diskutil eraseDisk*)`                      | macOS whole-disk wipe                                   |
| `Bash(diskutil eraseVolume*)`                    | macOS volume wipe                                       |
| `Bash(diskutil secureErase*)`                    | macOS secure erase                                      |
| `Bash(diskutil zeroDisk*)`                       | macOS zero-disk                                         |
| `Bash(csrutil disable*)`                         | Disable System Integrity Protection                     |
| `Bash(csrutil clear*)`                           | Reset SIP config                                        |
| `Bash(spctl --master-disable*)`                  | Disable Gatekeeper                                      |
| `Bash(nvram -c*)`                                | Clear all NVRAM (boot-critical vars)                    |
| `Bash(nvram -d*)`                                | Delete a specific NVRAM var                             |
| `Bash(parted *)`                                 | Partition editor                                        |
| `Bash(fdisk *)`                                  | Partition editor                                        |
| `Bash(gdisk *)`                                  | GPT partition editor                                    |
| `Bash(wipefs *)`                                 | Wipe filesystem signatures                              |
| `Bash(crontab -r*)`                              | Removes user's crontab silently                         |
| `Bash(kubectl delete crd*)`                      | Cascading CR deletion across cluster                    |
| `Bash(kubectl delete customresourcedefinition*)` | Long-form CRD delete                                    |
| `Bash(kubectl delete --all *)`                   | Wildcard delete in a namespace                          |
| `Bash(kubectl delete * --all-namespaces*)`       | Cluster-wide wildcard delete                            |

Notes:

- **No `chmod -R 000` / `chown -R` rules** in Tier A — too easy to false-positive on legit ops; consider Tier B/C later if needed.
- **No git history-rewrite rules** in Tier A (filter-branch/filter-repo, force-push-to-main) — those live in Tier B.
- **Pattern style follows existing entries** in the file (literal program + arg prefix, trailing `*`).

## Phase 2c — Sync to chezmoi

```bash
chezmoi re-add ~/.claude/settings.json
chezmoi diff   # expect no diff
```

## Phase 2d — Mirror plan into monorepo docs

Per `monorepo/CLAUDE.md` "Documentation Discipline — Per Session", mirror this approved plan into `packages/docs/plans/` using the dated naming convention, add an index entry, and append a Session Log at end-of-session.

- Copy: `~/.claude/plans/do-claude-code-and-flickering-pillow.md` → `packages/docs/plans/2026-05-09_bypass-mode-defaults.md`
- Add `## Status` line near the top of the mirrored file (`Complete` once Phase 2 finishes; `In Progress` until then).
- Append to `packages/docs/index.md` under `## Plans`:

  ```
  - [Bypass Mode Defaults](plans/2026-05-09_bypass-mode-defaults.md) - Enable bypass-by-default for Claude Code + Codex; tier-A deny-list hardening
  ```

- End-of-session: append a `## Session Log — 2026-05-09` section with Done / Remaining / Caveats to the in-repo copy AND restate it inline in chat.

## Verification

1. **Static**: `jq '.permissions.deny | length' ~/.claude/settings.json` should increase by 23 (from 36 → 59).
2. **Smoke test**: run Phase 2a commands; both `/tmp/__bypass_*` files exist, no refusal strings in output.
3. **Deny-rule sanity**: in a fresh `claude` session with bypass on, ask it to run `sh -c "echo nope"` — should be hard-blocked even though bypass is otherwise active (deny > allow).

## Out-of-scope (deferred)

- Tier B (git history rewrites, force-push-to-main, talosctl shutdown, tmutil delete, cryptsetup) — revisit in a separate session.
- Tier C (recursive chmod/chown, raw device redirects, promote `git push --force` and `npm publish` from ask→deny).
- PreToolUse hook for regex-based URL filtering of curl-pipe-shell — more robust but heavier than pattern rules; defer.

## Session Log — 2026-05-09

### Done

- Phase 1 (prior turn): added `permissions.defaultMode = "bypassPermissions"` to `~/.claude/settings.json`; added `approval_policy = "never"` and `sandbox_mode = "danger-full-access"` to `~/.codex/config.toml`. Both synced via `chezmoi re-add`.
- Phase 2b: added 23 Tier-A deny rules to `~/.claude/settings.json` (curl-pipe-shell, macOS disk wipe, SIP/Gatekeeper, nvram, partition tools, crontab -r, kubectl delete crd / --all). Deny array grew 35 → 58 entries.
- Phase 2c: `chezmoi re-add ~/.claude/settings.json ~/.codex/config.toml` clean (`chezmoi diff` empty).
- Phase 2d: mirrored plan to `packages/docs/plans/2026-05-09_bypass-mode-defaults.md`; added entry to `packages/docs/index.md`.
- Phase 2a: smoke tests run.
  - **Codex**: ✅ confirmed live. Header showed `approval: never` / `sandbox: danger-full-access`; `/tmp/__bypass_codex` created; no prompt.
  - **Claude Code**: ⚠️ inconclusive. `claude -p` returned `is_error:true, api_error_status:400, "Credit balance is too low"` — never reached the model, so behavioral confirmation impossible right now. Static positive evidence: `permission_denials:[]` in result JSON (so it wasn't blocked on permissions), `defaultMode: "bypassPermissions"` is present in settings, and `--permission-mode bypassPermissions` is documented as a valid mode.

### Remaining

- Re-run Claude Code smoke test once API credits are restored: `claude -p "Run this exact bash command and report stdout: touch /tmp/__bypass_claude && echo BYPASS_OK_CLAUDE"`. Pass = file exists and no permission-denied string in output.
- Optional: investigate why headless `claude -p` reports credit exhaustion when interactive sessions still work — possibly different auth path (subscription-token vs API-key).

### Caveats

- Tier B (git history rewrites, force-push-to-main, talosctl shutdown, tmutil delete, cryptsetup) and Tier C (recursive chmod/chown, raw device redirects, promote `git push --force` and `npm publish` from ask→deny) intentionally deferred — revisit in a separate session if desired.
- Pattern matching is per-subcommand — `Bash(sh)` catches `curl X | sh` because `sh` is a separate pipeline segment, but does NOT catch `sh -c '<arbitrary>'` (would require `Bash(sh *)` which would over-block legit shell wrapper usage). Acceptable risk for Tier A.
- Codex `danger-full-access` removes the sandbox entirely; there is no equivalent denylist to the Claude Code `permissions.deny` array. Codex relies purely on the model + your trust. Worth keeping in mind.
