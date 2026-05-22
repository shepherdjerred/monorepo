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

## Claude Code (Default)

```bash
clauderon create --agent claude --repo ~/project --prompt "Refactor the auth system"
```

Features: plan mode (disable with `--no-plan-mode`), tool use for file operations.

## Codex

```bash
clauderon create --agent codex --repo ~/project --prompt "Add input validation"
```

## Gemini

```bash
clauderon create --agent gemini --repo ~/project --prompt "Analyze the entire codebase"
```

## Choosing an Agent

| Task                    | Recommended          |
| ----------------------- | -------------------- |
| Complex refactoring     | Claude Code          |
| Quick fixes             | Claude Code or Codex |
| Large codebase analysis | Gemini               |
| Code generation         | Codex                |
| Architecture planning   | Claude Code          |

## Multiple Agents

Run sessions with different agents simultaneously:

```bash
clauderon create --agent claude --repo ~/project --prompt "Refactor auth"
clauderon create --agent gemini --repo ~/project --prompt "Document architecture"
clauderon list
```

Default agent is Claude Code. No config file setting exists; pass `--agent` per invocation.
