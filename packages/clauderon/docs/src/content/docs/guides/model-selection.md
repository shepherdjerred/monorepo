---
title: Model Selection
description: Choose the right AI model for your Clauderon sessions
---

22 models across three providers. Use `--model <flag>` when creating sessions.

## Claude Models (Anthropic)

| Model          | Flag         | Capability     | Speed    | Context | Notes          |
| -------------- | ------------ | -------------- | -------- | ------- | -------------- |
| **Opus 4.6**   | `opus-4-6`   | Most capable   | Moderate | 1M      | Most capable   |
| **Sonnet 4.6** | `sonnet-4-6` | Balanced       | Fast     | 1M      | **Default**    |
| **Haiku 4.5**  | `haiku-4-5`  | Moderate       | Fastest  | -       | Fastest Claude |
| **Opus 4.5**   | `opus-4-5`   | High           | Moderate | -       |                |
| **Sonnet 4.5** | `sonnet-4-5` | High           | Fast     | -       |                |
| **Opus 4.1**   | `opus-4-1`   | High (Agentic) | Moderate | -       | Agentic tasks  |
| **Opus 4**     | `opus-4`     | High           | Moderate | -       |                |
| **Sonnet 4**   | `sonnet-4`   | Moderate       | Fast     | -       |                |

## Codex/OpenAI Models

| Model             | Flag            | Capability           | Speed    | Notes                |
| ----------------- | --------------- | -------------------- | -------- | -------------------- |
| **GPT-5.3-Codex** | `gpt-5-3-codex` | High (Code)          | Moderate | **Default** - coding |
| **GPT-5.4**       | `gpt-5-4`       | Flagship             | Moderate |                      |
| **GPT-5.4 Mini**  | `gpt-5-4-mini`  | High                 | Fast     |                      |
| **GPT-5.4 Nano**  | `gpt-5-4-nano`  | Moderate             | Fastest  | Cost-effective       |
| **GPT-5.4 Pro**   | `gpt-5-4-pro`   | Highest              | Slow     | Premium              |
| **o3**            | `o3`            | High (Reasoning)     | Moderate |                      |
| **o3-pro**        | `o3-pro`        | Highest (Reasoning)  | Slow     | Premium              |
| **o4-mini**       | `o4-mini`       | High (Reasoning)     | Fast     |                      |
| **o3-mini**       | `o3-mini`       | Moderate (Reasoning) | Fast     |                      |

## Gemini Models (Google)

| Model                     | Flag                    | Capability | Speed    | Context |
| ------------------------- | ----------------------- | ---------- | -------- | ------- |
| **Gemini 3.1 Pro**        | `gemini-3-1-pro`        | Highest    | Moderate | 1M      |
| **Gemini 3 Flash**        | `gemini-3-flash`        | High       | Fastest  | -       |
| **Gemini 3.1 Flash-Lite** | `gemini-3-1-flash-lite` | Moderate   | Fastest  | -       |
| **Gemini 2.5 Pro**        | `gemini-2-5-pro`        | High       | Moderate | 1M      |
| **Gemini 2.5 Flash**      | `gemini-2-5-flash`      | Moderate   | Fast     | -       |

## Usage

```bash
# CLI
clauderon create --model opus-4-6 --repo ~/project --prompt "Refactor auth module"

# API
curl -X POST http://localhost:3030/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "my-session", "repository": "/path/to/repo", "backend": "docker", "agent": "claude-code", "model": "opus-4-6"}'
```

TUI and Web UI: select model from dropdown during session creation.

## Choosing a Model

| Use Case            | Recommended Model                                |
| ------------------- | ------------------------------------------------ |
| Most tasks          | Sonnet 4.6 (default)                             |
| Complex refactoring | Opus 4.6                                         |
| Quick iterations    | Haiku 4.5                                        |
| Large codebases     | Gemini 3.1 Pro (1M)                              |
| Code generation     | GPT-5.3-Codex                                    |
| Deep reasoning      | o3 or Opus 4.1                                   |
| Cost optimization   | Haiku 4.5 / GPT-5.4 Nano / Gemini 3.1 Flash-Lite |

## API Keys

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # Claude
export OPENAI_API_KEY="sk-..."          # OpenAI/Codex
export GOOGLE_API_KEY="AIza..."         # Gemini
```

Models cannot be changed mid-session. Recreate the session to switch models.
