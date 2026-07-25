---
id: reference-completed-2026-07-19-opencode-codex-usage
type: reference
status: complete
board: false
---

# OpenCode Codex Usage Visibility

## Goal

Expose Codex subscription quota and API-equivalent token costs inside OpenCode without changing the existing Kimi integration.

## Implementation

1. Register `@slkiser/opencode-quota@3.11.2` as a global OpenCode server and TUI plugin.
2. Restrict quota collection to the `openai` provider.
3. Show every quota window returned by OpenAI in the sidebar and compact status line, using remaining percentages and reset times.
4. Enable session token summaries and the plugin's daily, weekly, monthly, all-time, and session token-cost commands.
5. Use the current `models.dev` pricing snapshot for API-equivalent cost estimates.
6. Disable quota pop-up toasts and bundled maintainer announcements.
7. Apply the chezmoi-managed configuration to the live OpenCode config and verify the provider, plugin, quota, pricing, and TUI surfaces.

## Acceptance Criteria

- The live and chezmoi-source OpenCode configurations match.
- `/quota` and the compact/sidebar surfaces show every Codex window returned by the account endpoint.
- `/tokens_session`, `/tokens_weekly`, and `/tokens_monthly` expose token counts and API-equivalent costs.
- GPT-5.6 model pricing resolves from a refreshed `models.dev` snapshot.
- Existing Kimi provider and plugin configuration is unchanged.
- The current missing 5-hour Codex window is not fabricated; it appears automatically if OpenAI later returns it.

## Session Log — 2026-07-19

### Done

- Added the pinned `@slkiser/opencode-quota@3.11.2` server plugin to `packages/dotfiles/private_dot_config/private_opencode/private_opencode.jsonc` without changing the existing Kimi provider or plugin.
- Added the TUI plugin in `packages/dotfiles/private_dot_config/private_opencode/private_tui.jsonc`.
- Added Codex-only quota settings in `packages/dotfiles/private_dot_config/private_opencode/private_opencode-quota/private_quota-toast.json`: all returned windows, remaining percentages, sidebar, compact home/session status, session tokens, daily pricing refresh, no popup toasts, and no maintainer announcements.
- Disabled compact-status suppression for OpenCode's advertised experimental native quota client because OpenCode 1.18.3 does not render that quota on the home screen.
- Applied the worktree's chezmoi source to `~/.config/opencode`; all three live files match their source and have mode `0600`.
- Verified OpenCode resolves `/quota`, `/quota_status`, `/pricing_refresh`, and every `/tokens_*` command.
- Verified the live Codex endpoint and TUI render path report the active weekly window; the expanded sidebar reports its reset and session token totals.
- Verified the refreshed `models.dev` snapshot contains GPT-5.6 Luna, Sol, and Terra rates and prices all observed OpenAI rows without unknown models.
- Removed the three temporary OpenCode sessions created during command and TUI smoke testing.

### Remaining

- None.

### Caveats

- OpenCode loads configuration once; quit and restart the currently running OpenCode process to activate the new TUI surfaces.
- The Codex account endpoint currently returns only a 604,800-second weekly window. The 5-hour window is `null`; it will appear automatically if OpenAI starts returning it.
- Native `opencode stats` retains the OAuth provider's `$0.00` billing cost. The `/tokens_*` commands calculate separate API-equivalent estimates from current `models.dev` prices.
- Quota collection is restricted to OpenAI. Kimi quota behavior is unchanged, although session token summaries can include Kimi messages used in the current session.
- Repository changes remain uncommitted in the `feature/opencode-codex-usage` worktree because no commit or PR was requested; the default chezmoi source on `main` will include them only after that branch is integrated.

## Session Log — 2026-07-19 (Local Fork Migration)

### Done

- Replaced the upstream npm quota plugin with the built filesystem entrypoints from `~/git/opencode-quota`.
- Expanded the live provider set from OpenAI-only to OpenAI, xAI, and Kimi through the maintained fork.
- Reconciled the live files with the current chezmoi templates after the OpenCode safety-config migration.

### Remaining

- None.

### Caveats

- This document records the original Codex-only deployment. The completed subscription-quota reference supersedes its provider and plugin-registration scope.
