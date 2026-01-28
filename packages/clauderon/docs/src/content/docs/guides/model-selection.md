---
title: Model Selection
description: Choose the right AI model for your Clauderon sessions
---

Clauderon supports 22 different AI models across three major providers: Claude (Anthropic), GPT/Codex (OpenAI), and Gemini (Google). This guide helps you choose the right model for your use case.

## Overview

Different models offer different trade-offs:

- **Capability** - Complex reasoning, code generation, refactoring
- **Speed** - Response latency and throughput
- **Cost** - Token pricing and context window efficiency
- **Context** - Maximum input/output size
- **Features** - Plan mode, tool use, multi-modal support

## Model Families

### Claude Models (Anthropic)

7 Claude models available, powered by Anthropic's latest technology:

| Model | Capability | Speed | Context | Use Cases |
|-------|-----------|-------|---------|-----------|
| **Claude Opus 4.5** | Highest | Moderate | 200K | Complex refactoring, architecture design |
| **Claude Sonnet 4.5** | High | Fast | 200K | **Default** - balanced for most tasks |
| **Claude Haiku 4.5** | Moderate | Fastest | 200K | Quick edits, simple tasks, iterations |
| **Claude Opus 4.1** | High (Agentic) | Moderate | 200K | Multi-step reasoning, planning |
| **Claude Opus 4** | High | Moderate | 200K | Previous generation, still capable |
| **Claude Sonnet 4** | Moderate | Fast | 200K | Previous generation, fast |
| **Claude Haiku 4** | Lower | Fastest | 200K | Previous generation, simple tasks |

**Model IDs:**
- `claude-opus-4-5` or `claude-opus-4-5-20251101`
- `claude-sonnet-4-5` or `claude-sonnet-4-5-20250929` (default)
- `claude-haiku-4-5` or `claude-haiku-4-5-20250701`
- `claude-opus-4-1` or `claude-opus-4-1-20241129`
- `claude-opus-4` or `claude-opus-4-20240229`
- `claude-sonnet-4` or `claude-sonnet-4-20240229`
- `claude-haiku-4` or `claude-haiku-4-20240307`

**Features:**
- ✅ Plan mode supported (all models)
- ✅ Tool use (function calling)
- ✅ Multi-modal (image understanding)
- ✅ Extended thinking (Opus models)
- ✅ Code generation optimized

**Authentication:**
- Requires Anthropic API key or OAuth

### GPT/Codex Models (OpenAI)

10 GPT models available, including specialized Codex variants:

| Model | Capability | Speed | Context | Use Cases |
|-------|-----------|-------|---------|-----------|
| **GPT-5.2-Codex** | Highest (Code) | Moderate | 128K | **Default GPT** - optimized for code |
| **GPT-5.2** | Highest | Moderate | 128K | General tasks, reasoning |
| **GPT-5.2-Instant** | High | Fastest | 128K | Quick responses, iterations |
| **GPT-5.2-Thinking** | Highest | Slowest | 128K | Complex reasoning, deep analysis |
| **GPT-5.2-Pro** | Highest+ | Slow | 128K | Most capable, expensive |
| **GPT-5.1** | High | Fast | 128K | Previous generation, balanced |
| **GPT-5.1-Instant** | Moderate | Fastest | 128K | Previous generation, fast |
| **GPT-5.1-Thinking** | High | Slow | 128K | Previous generation, reasoning |
| **GPT-4.1** | Moderate | Fast | 8K | Older generation, lower cost |
| **o3-mini** | High (Reasoning) | Moderate | 128K | Specialized reasoning model |

**Model IDs:**
- `gpt-5.2-codex` (default for GPT)
- `gpt-5.2`
- `gpt-5.2-instant`
- `gpt-5.2-thinking`
- `gpt-5.2-pro`
- `gpt-5.1`
- `gpt-5.1-instant`
- `gpt-5.1-thinking`
- `gpt-4.1`
- `o3-mini`

**Features:**
- ✅ Tool use (function calling)
- ✅ Code generation (especially Codex variants)
- ⚠️ Plan mode (limited support)
- ✅ Multi-modal (GPT-5.2 models)
- ✅ Thinking mode (Thinking variants)

**Authentication:**
- Requires OpenAI API key

### Gemini Models (Google)

5 Gemini models available, featuring very large context windows:

| Model | Capability | Speed | Context | Use Cases |
|-------|-----------|-------|---------|-----------|
| **Gemini 3 Pro** | Highest | Moderate | 1M | Huge codebases, large context |
| **Gemini 3 Flash** | High | Fastest | 1M | Fast iterations with large context |
| **Gemini 2.5 Pro** | High | Moderate | 1M | Previous generation, still capable |
| **Gemini 2.0 Flash** | Moderate | Fastest | 1M | Previous generation, fast |
| **Gemini 2.0 Flash-Thinking** | High | Slow | 1M | Reasoning with large context |

**Model IDs:**
- `gemini-3-pro`
- `gemini-3-flash` (default for Gemini)
- `gemini-2.5-pro`
- `gemini-2.0-flash`
- `gemini-2.0-flash-thinking`

**Features:**
- ✅ Very large context (1M tokens)
- ✅ Tool use
- ✅ Multi-modal
- ⚠️ Plan mode (limited support)
- ✅ Flash models for speed

**Authentication:**
- Requires Google AI API key

## Selecting Models

### Via Web UI

The Web UI provides full model selection:

1. **Create New Session**
   - Click "New Session"
   - Configure repository and backend

2. **Advanced Options**
   - Expand "Advanced Options" section
   - Find "Model Override" dropdown

3. **Choose Model**
   - Browse all 22 available models
   - Models grouped by provider (Claude, GPT, Gemini)
   - Default model shown (Claude Sonnet 4.5)

4. **Create Session**
   - Model applies to this session only
   - Can be changed by recreating session

### Via API

Specify model in session creation request:

```bash
curl -X POST http://localhost:3030/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-session",
    "repository": "/path/to/repo",
    "backend": "docker",
    "agent": "claude-code",
    "model": "claude-opus-4-5"
  }'
```

**Model parameter:**
- Optional (defaults to `claude-sonnet-4-5`)
- Must be valid model ID
- Case-sensitive

### Via CLI

**Status:** Not yet implemented

The CLI currently does not support model selection. Model defaults to Claude Sonnet 4.5.

**Workaround:**
- Create session via Web UI or API with desired model
- Attach to session from CLI:
  ```bash
  clauderon attach my-session
  ```

### Via TUI

**Status:** Not yet implemented

The TUI currently does not support model selection during session creation.

**Workaround:**
- Create session via Web UI or API with desired model
- Attach to session from TUI:
  ```bash
  clauderon tui
  # Select and attach to pre-created session
  ```

## Model Capabilities Comparison

### Plan Mode Support

Plan mode allows the agent to create an implementation plan before executing:

| Provider | Plan Mode Support |
|----------|-------------------|
| Claude | ✅ Full support (all models) |
| GPT | ⚠️ Limited support (best with Thinking models) |
| Gemini | ⚠️ Limited support |

**Best for plan mode:** Claude Opus 4.5, Claude Sonnet 4.5

### Context Window Sizes

| Provider | Context Window |
|----------|---------------|
| Claude | 200K tokens |
| GPT | 128K tokens (most), 8K (GPT-4.1) |
| Gemini | 1M tokens |

**Best for large codebases:** Gemini 3 Pro, Gemini 3 Flash

### Code Generation

All models support code generation, but some are optimized:

- **Best:** GPT-5.2-Codex (specialized for code)
- **Excellent:** Claude Opus 4.5, Claude Sonnet 4.5
- **Very Good:** GPT-5.2, Gemini 3 Pro
- **Good:** All other models

### Speed

Fastest to slowest (approximate):

1. **Fastest:** Claude Haiku 4.5, GPT-5.2-Instant, Gemini 3 Flash
2. **Fast:** Claude Sonnet 4.5, GPT-5.1, Gemini 2.0 Flash
3. **Moderate:** Claude Opus 4.5, GPT-5.2, Gemini 3 Pro
4. **Slow:** GPT-5.2-Thinking, Gemini 2.0 Flash-Thinking
5. **Slowest:** GPT-5.2-Pro

### Cost

**Approximate relative costs** (actual pricing varies by provider):

- **Most Expensive:** GPT-5.2-Pro, Claude Opus 4.5
- **Expensive:** GPT-5.2, Claude Opus 4.1, Gemini 3 Pro
- **Moderate:** Claude Sonnet 4.5, GPT-5.1, Gemini 2.5 Pro
- **Affordable:** GPT-5.1-Instant, Gemini 3 Flash
- **Economical:** Claude Haiku 4.5, GPT-4.1, Gemini 2.0 Flash

**Check provider pricing pages for exact rates.**

## Backend Compatibility

All models work with all backends:

- ✅ Docker - Full support
- ✅ Kubernetes - Full support
- ✅ Zellij - Full support
- ✅ Sprites - Full support
- ✅ Apple Container - Full support

Model selection is independent of backend choice.

## Authentication Requirements

### API Keys

Most models require API keys:

**Claude models:**
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

**GPT models:**
```bash
export OPENAI_API_KEY="sk-..."
```

**Gemini models:**
```bash
export GOOGLE_API_KEY="AIza..."
```

### OAuth (Claude Only)

Claude models can also use OAuth:

```bash
clauderon auth login
# Opens browser for OAuth flow
```

OAuth tokens are stored securely and automatically refreshed.

## Choosing the Right Model

### For Most Tasks (Default)

**Claude Sonnet 4.5** - Best balance of capability, speed, and cost

```json
{
  "model": "claude-sonnet-4-5"
}
```

### For Complex Refactoring

**Claude Opus 4.5** - Highest capability, best for architecture and complex changes

```json
{
  "model": "claude-opus-4-5"
}
```

### For Quick Iterations

**Claude Haiku 4.5** or **GPT-5.2-Instant** - Fastest responses

```json
{
  "model": "claude-haiku-4-5"
}
```

### For Large Codebases

**Gemini 3 Pro** - 1M token context window

```json
{
  "model": "gemini-3-pro"
}
```

### For Code Generation

**GPT-5.2-Codex** - Optimized for coding tasks

```json
{
  "model": "gpt-5.2-codex"
}
```

### For Deep Reasoning

**GPT-5.2-Thinking** or **Claude Opus 4.1** - Extended thinking capabilities

```json
{
  "model": "gpt-5.2-thinking"
}
```

### For Cost Optimization

**Claude Haiku 4.5** or **Gemini 2.0 Flash** - Most economical

```json
{
  "model": "claude-haiku-4-5"
}
```

## Model Selection Strategies

### Development Workflow

Use different models at different stages:

1. **Exploration** - Claude Sonnet 4.5 (balanced)
2. **Implementation** - GPT-5.2-Codex (code optimized)
3. **Refactoring** - Claude Opus 4.5 (complex changes)
4. **Testing/Debugging** - Claude Haiku 4.5 (quick iterations)

### Task-Based Selection

**Bug fixes:** Claude Haiku 4.5 (fast, good enough)
**New features:** Claude Sonnet 4.5 (balanced)
**Architecture design:** Claude Opus 4.5 (complex reasoning)
**Code review:** GPT-5.2-Codex (code understanding)
**Documentation:** Claude Sonnet 4.5 (good writing)
**Large codebase navigation:** Gemini 3 Pro (huge context)

### Budget Optimization

**High budget:** Use Claude Opus 4.5 or GPT-5.2-Pro for everything
**Medium budget:** Use Claude Sonnet 4.5 as default, Opus for complex tasks
**Low budget:** Use Claude Haiku 4.5 or Gemini Flash, Sonnet only when needed

### Speed Optimization

**Need fastest responses:** Claude Haiku 4.5, GPT-5.2-Instant, Gemini 3 Flash
**Balanced speed/quality:** Claude Sonnet 4.5, GPT-5.2
**Quality over speed:** Claude Opus 4.5, GPT-5.2-Thinking

## Model Switching

### During Session

Models cannot be changed mid-session. To switch models:

1. **Recreate session** with new model:
   ```bash
   # Via Web UI: Session → Recreate → Choose new model
   # Or create new session
   ```

2. **Session state preserved** (if using "Recreate" option)
   - Chat history maintained
   - Git state preserved
   - Metadata retained

### Multi-Session Strategy

Run multiple sessions with different models:

```bash
# Session 1: Exploration (Sonnet)
clauderon create --model claude-sonnet-4-5 exploration

# Session 2: Complex refactor (Opus)
clauderon create --model claude-opus-4-5 refactor

# Session 3: Quick fixes (Haiku)
clauderon create --model claude-haiku-4-5 fixes
```

## Best Practices

1. **Start with default** - Claude Sonnet 4.5 works for most tasks
2. **Upgrade for complexity** - Use Opus when Sonnet struggles
3. **Downgrade for speed** - Use Haiku for simple, quick tasks
4. **Match context to codebase** - Use Gemini for very large projects
5. **Consider cost** - Monitor token usage and adjust accordingly
6. **Test different models** - Different models excel at different tasks
7. **Use plan mode** - Leverage Claude's plan mode for complex implementations
8. **Codex for pure coding** - GPT-5.2-Codex for heavy code generation
9. **Thinking for reasoning** - Use Thinking variants for complex logic
10. **Flash for iteration** - Gemini Flash or GPT Instant for rapid feedback

## Troubleshooting

### Model Not Available

**Error:** `Model 'xyz' not found`

**Causes:**
- Typo in model ID
- Model not supported by Clauderon
- Model deprecated or renamed

**Solution:**
- Check model ID spelling (case-sensitive)
- Refer to model list above
- Use default model if unsure

### Authentication Failed

**Error:** `Authentication failed for model`

**Causes:**
- API key not set
- API key invalid or expired
- Wrong provider for model (e.g., OpenAI key for Claude model)

**Solution:**
```bash
# Check environment variables
echo $ANTHROPIC_API_KEY
echo $OPENAI_API_KEY
echo $GOOGLE_API_KEY

# Set missing key
export ANTHROPIC_API_KEY="sk-ant-..."

# Or use OAuth (Claude only)
clauderon auth login
```

### Rate Limiting

**Error:** `Rate limit exceeded`

**Causes:**
- Too many requests to provider API
- Account limits reached
- Concurrent session limit

**Solutions:**
- Wait and retry
- Upgrade API tier with provider
- Use different model/provider
- Reduce concurrent sessions

### Poor Quality Responses

**Problem:** Model produces low-quality code or explanations

**Solutions:**
- Try a more capable model (e.g., Opus instead of Haiku)
- Use Codex variant for code tasks
- Enable plan mode for complex tasks
- Provide more context in prompt
- Break task into smaller steps

### Slow Responses

**Problem:** Model takes too long to respond

**Solutions:**
- Use faster model (Haiku, Instant, Flash)
- Reduce context size (smaller prompts)
- Use streaming (enabled by default)
- Check network latency to provider

### Context Window Exceeded

**Error:** `Context window exceeded`

**Causes:**
- Codebase too large for model's context
- Too much chat history
- Large file attachments

**Solutions:**
- Use Gemini models (1M context)
- Archive old sessions (clear history)
- Work with smaller portions of codebase
- Remove large files from context

## Model-Specific Tips

### Claude Opus 4.5

- Best for plan mode (creates detailed implementation plans)
- Excellent at refactoring entire codebases
- Use for architecture decisions
- Higher cost, reserve for complex tasks

### Claude Sonnet 4.5

- Default for good reason - balanced all-around
- Fast enough for iterative development
- Capable enough for most tasks
- Best cost/performance ratio

### Claude Haiku 4.5

- Use for quick edits and simple tasks
- Great for testing and debugging loops
- Much faster than Opus/Sonnet
- Lowest cost option for Claude

### GPT-5.2-Codex

- Specialized for code generation
- Better at boilerplate and repetitive code
- May be less creative than Claude for architecture
- Good for pure coding tasks

### Gemini 3 Pro

- Use when you need 1M context window
- Great for exploring large codebases
- Can handle entire monorepos in context
- Slower than Flash variants

### GPT-5.2-Thinking

- Use for complex algorithmic problems
- Shows reasoning steps (helpful for learning)
- Slower but more thorough
- Good for debugging complex issues

## See Also

- [Configuration Reference](/reference/configuration/) - Model configuration options
- [API Reference](/reference/api/) - Model selection via API
- [Feature Parity](/reference/feature-parity/) - Model support by interface
- [Claude Models](https://anthropic.com/models) - Official Claude model docs
- [OpenAI Models](https://platform.openai.com/docs/models) - Official GPT model docs
- [Gemini Models](https://ai.google.dev/models/gemini) - Official Gemini model docs
