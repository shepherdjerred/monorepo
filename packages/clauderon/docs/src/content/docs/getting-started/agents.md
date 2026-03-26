---
title: Agents
description: Choose and configure AI agents for your sessions
---

## Supported Agents

| Agent       | Provider  | Context Window | Best For                          |
| ----------- | --------- | -------------- | --------------------------------- |
| Claude Code | Anthropic | 200K tokens    | General coding, complex reasoning |
| Codex       | OpenAI    | 128K tokens    | Code generation, completions      |
| Gemini      | Google    | 1M tokens      | Large codebase analysis           |

## Credential Summary

| Agent       | Secret File             | Environment Variable      |
| ----------- | ----------------------- | ------------------------- |
| Claude Code | `anthropic_oauth_token` | `CLAUDE_CODE_OAUTH_TOKEN` |
| Codex       | `openai_api_key`        | `OPENAI_API_KEY`          |
| Gemini      | `google_api_key`        | `GOOGLE_API_KEY`          |

All credentials can also be stored in [1Password](/guides/onepassword/).

## Claude Code (Default)

```bash
clauderon create --agent claude --repo ~/project --prompt "Refactor the auth system"
```

Authentication:

```bash
echo "your-anthropic-oauth-token" > ~/.clauderon/secrets/anthropic_oauth_token
chmod 600 ~/.clauderon/secrets/anthropic_oauth_token
```

Or via 1Password:

```toml
# ~/.clauderon/proxy.toml
[onepassword.credentials]
anthropic_oauth_token = "op://Private/Claude/oauth-token"
```

Features: plan mode (disable with `--no-plan-mode`), tool use for file operations.

## Codex

```bash
clauderon create --agent codex --repo ~/project --prompt "Add input validation"
```

Authentication:

```bash
echo "your-openai-api-key" > ~/.clauderon/secrets/openai_api_key
chmod 600 ~/.clauderon/secrets/openai_api_key
```

Codex auth file location:

```toml
# ~/.clauderon/proxy.toml
codex_auth_json_path = "~/.codex/auth.json"
```

## Gemini

```bash
clauderon create --agent gemini --repo ~/project --prompt "Analyze the entire codebase"
```

Authentication:

```bash
echo "your-google-api-key" > ~/.clauderon/secrets/google_api_key
chmod 600 ~/.clauderon/secrets/google_api_key
```

## Choosing an Agent

| Task                    | Recommended           |
| ----------------------- | --------------------- |
| Complex refactoring     | Claude Code           |
| Quick fixes             | Claude Code or Codex  |
| Large codebase analysis | Gemini                |
| Code generation         | Codex                 |
| Architecture planning   | Claude Code           |

## Multiple Agents

Run sessions with different agents simultaneously:

```bash
clauderon create --agent claude --repo ~/project --prompt "Refactor auth"
clauderon create --agent gemini --repo ~/project --prompt "Document architecture"
clauderon list
```

Default agent is Claude Code. No config file setting exists; pass `--agent` per invocation.
