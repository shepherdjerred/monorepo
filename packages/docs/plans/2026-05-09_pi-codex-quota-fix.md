# pi v0.74.0 Codex quota error — root cause & fix

## Status

Complete

## Context

After running `pi` (v0.74.0, `@earendil-works/pi-coding-agent`), every prompt failed with:

```
Error: You exceeded your current quota, please check your plan and billing details.
```

…even though pi reported `Logged in to ChatGPT Plus/Pro (Codex Subscription)`. Goal: identify root cause and fix without burning Codex quota on speculative retries.

## Root cause

`pi` exposes **two distinct providers** for OpenAI:

| Provider       | Auth                                | Endpoint       | Models                  |
| -------------- | ----------------------------------- | -------------- | ----------------------- |
| `openai`       | `OPENAI_API_KEY` env / API key      | api.openai.com | standard public models  |
| `openai-codex` | OAuth via ChatGPT Plus/Pro `/login` | Codex backend  | `gpt-5.x-codex*` family |

The user's `~/.pi/agent/settings.json` had `"defaultProvider": "openai"` while the auth file `~/.pi/agent/auth.json` only contained an `"openai-codex"` OAuth entry, and no `OPENAI_API_KEY` was set in the environment. pi therefore routed to api.openai.com with no credentials and surfaced OpenAI's canonical `insufficient_quota` error.

`/login` saved the OAuth token correctly but did not rewrite `defaultProvider` (settings.json was last touched at 12:32; auth.json at 12:35).

Status line confirmation: pi rendered `(openai) gpt-5.3-codex • xhigh` — the wrong provider was bound at startup.

## Fix

`~/.pi/agent/settings.json`:

```diff
-  "defaultProvider": "openai",
+  "defaultProvider": "openai-codex",
```

Resulting file:

```json
{
  "lastChangelogVersion": "0.74.0",
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.3-codex",
  "theme": "light",
  "defaultThinkingLevel": "xhigh"
}
```

Not chezmoi-managed today (file lives under `~/.pi/agent/`, not `packages/dotfiles/`). Adding it to chezmoi would be reasonable if pi becomes a daily driver — out of scope for this fix.

## Verification

1. `jq . /Users/jerred/.pi/agent/settings.json` → confirms `defaultProvider` is `openai-codex`. ✅
2. `pi -p "respond with exactly: PI_OK"` → returns `PI_OK`, no quota error. ✅

## Notes for next time

- If `pi` ever shows the same error again with `(openai-codex)` already selected, the cause is different: either the OAuth token expired (check `expires` field in `auth.json`) or the ChatGPT account hit its actual Codex weekly cap (different error wording — "usage limit reached" rather than "exceeded your current quota").
- `pi --list-models` is the fastest way to confirm which providers pi recognises and which models map to them.
- Related upstream context: pi GitHub issue #2936 ("Provider defaulting to anthropic, can't change") describes the same class of bug — `/login` doesn't always rewrite `defaultProvider`.

## Session Log — 2026-05-09

### Done

- Edited `/Users/jerred/.pi/agent/settings.json`: `defaultProvider` `"openai"` → `"openai-codex"`.
- Verified with `pi -p` smoke test (`PI_OK` returned, no quota error).
- Created this plan and added entry to `packages/docs/index.md`.

### Remaining

- None for the immediate bug. Optional follow-up if pi becomes a regular tool: add `~/.pi/agent/settings.json` to `packages/dotfiles/private_dot_pi/` so the setting persists across machines.

### Caveats

- We did not test other models or providers — only the `gpt-5.3-codex` default.
- The OAuth token expires 2026-05-19; `/login` will need to refresh before then if pi doesn't auto-refresh.
