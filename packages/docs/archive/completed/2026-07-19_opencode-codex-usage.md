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
