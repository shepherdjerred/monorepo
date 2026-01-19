---
title: Agents
description: Choose and configure AI agents for your sessions
---

clauderon supports multiple AI agents, allowing you to choose the best model for your task.

## Supported Agents

| Agent | Provider | Context Window | Best For |
|-------|----------|---------------|----------|
| Claude Code | Anthropic | 200K tokens | General coding, complex reasoning |
| Codex | OpenAI | 128K tokens | Code generation, completions |
| Gemini | Google | 1M tokens | Large codebase analysis |

## Claude Code (Default)

Anthropic's Claude-based coding agent, optimized for software engineering tasks.

**Strengths:**
- Strong reasoning and planning
- Excellent code understanding
- Good at explaining decisions
- Follows instructions carefully

**Best for:**
- Complex refactoring
- Debugging difficult issues
- Code review
- Architecture decisions

```bash
clauderon create --agent claude --repo ~/project --prompt "Refactor the auth system"
```

### Authentication

Claude Code uses OAuth tokens. Store your token:

```bash
echo "your-anthropic-oauth-token" > ~/.clauderon/secrets/anthropic_oauth_token
chmod 600 ~/.clauderon/secrets/anthropic_oauth_token
```

Or use 1Password:

```toml
# ~/.clauderon/proxy.toml
[onepassword.credentials]
anthropic_oauth_token = "op://Private/Claude/oauth-token"
```

## Codex

OpenAI's code-focused model, designed for code generation and completion.

**Strengths:**
- Fast code generation
- Good at completing patterns
- Strong at common programming tasks

**Best for:**
- Quick code generation
- Boilerplate creation
- Simple modifications

```bash
clauderon create --agent codex --repo ~/project --prompt "Add input validation"
```

### Authentication

Codex uses OpenAI API keys. Store your key:

```bash
echo "your-openai-api-key" > ~/.clauderon/secrets/openai_api_key
chmod 600 ~/.clauderon/secrets/openai_api_key
```

Or use environment variable:

```bash
export OPENAI_API_KEY="your-key"
```

### Codex Auth File

Codex may use an auth.json file. Configure its location:

```toml
# ~/.clauderon/proxy.toml
codex_auth_json_path = "~/.codex/auth.json"
```

## Gemini

Google's multimodal model with an exceptionally large context window.

**Strengths:**
- 1 million token context window
- Good at analyzing large codebases
- Multimodal capabilities (images)

**Best for:**
- Large codebase exploration
- Understanding complex systems
- Projects with many files

```bash
clauderon create --agent gemini --repo ~/project --prompt "Analyze the entire codebase"
```

### Authentication

Gemini uses Google API keys. Store your key:

```bash
echo "your-google-api-key" > ~/.clauderon/secrets/google_api_key
chmod 600 ~/.clauderon/secrets/google_api_key
```

## Choosing an Agent

### By Task Type

| Task | Recommended Agent |
|------|------------------|
| Complex refactoring | Claude Code |
| Quick fixes | Claude Code or Codex |
| Large codebase analysis | Gemini |
| Code generation | Codex |
| Architecture planning | Claude Code |
| Code review | Claude Code |
| Documentation | Claude Code or Gemini |

### By Codebase Size

| Size | Recommended Agent |
|------|------------------|
| Small (<10K lines) | Any |
| Medium (10K-100K lines) | Claude Code |
| Large (100K-500K lines) | Claude Code or Gemini |
| Very large (>500K lines) | Gemini |

## Setting Default Agent

Configure your preferred default in `~/.clauderon/config.toml`:

```toml
[general]
default_agent = "claude"  # or codex, gemini
```

Or specify per-session:

```bash
clauderon create --agent gemini --repo ~/project --prompt "Task"
```

## Agent-Specific Features

### Claude Code Features

- Plan mode for complex tasks
- Tool use for file operations
- Memory across conversations (coming soon)

Use `--no-plan-mode` to skip planning:

```bash
clauderon create --agent claude --no-plan-mode \
  --repo ~/project --prompt "Quick fix"
```

### Gemini Features

- Image understanding for diagrams
- Very long context for large files
- Multimodal analysis

### Codex Features

- Fast inference
- Code-optimized tokenization
- Fill-in-the-middle completion

## Multiple Agents

You can run sessions with different agents simultaneously:

```bash
# Claude for complex work
clauderon create --agent claude --repo ~/project --prompt "Refactor auth"

# Gemini for codebase analysis
clauderon create --agent gemini --repo ~/project --prompt "Document architecture"

# List all sessions
clauderon list
```

## Credential Summary

| Agent | Secret File | Environment Variable |
|-------|-------------|---------------------|
| Claude Code | `anthropic_oauth_token` | `CLAUDE_CODE_OAUTH_TOKEN` |
| Codex | `openai_api_key` | `OPENAI_API_KEY` |
| Gemini | `google_api_key` | `GOOGLE_API_KEY` |

All credentials can also be stored in 1Password. See [1Password Guide](/guides/onepassword/).

## See Also

- [Quick Start](/getting-started/quick-start/) - Create your first session
- [1Password Guide](/guides/onepassword/) - Secure credential management
- [Configuration Reference](/reference/configuration/) - All configuration options
