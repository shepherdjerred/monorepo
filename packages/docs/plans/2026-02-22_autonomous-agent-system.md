# Autonomous Agent System Architecture Research

Research and design decisions for the Sentinel autonomous agent system. This document captures the architectural reasoning, technology choices, and design patterns that informed the [implementation plan](sentinel-implementation.md).

## Context: What We Want to Build and Why

The monorepo has several operational tasks that are repetitive, time-sensitive, and well-suited for automation:

- **CI failures on main/release-please**: When CI breaks, someone needs to investigate logs, identify the failing test or lint error, and either fix it or open an issue. This is mechanical investigation work that an AI agent can handle.
- **PagerDuty alert triage**: Alerts fire, someone needs to check cluster health, review recent deployments, and determine severity. Most of this is read-only investigation.
- **Scout for LoL / Bugsink failures**: Application errors need investigation — checking logs, recent changes, and determining root cause.
- **Cluster/app health checks**: Periodic verification that services are running, ArgoCD apps are synced, and resources are healthy.
- **Personal assistant tasks**: Ad-hoc requests like "check why this deployment is stuck" or "summarize recent CI failures".

The key insight: **agents should investigate and propose, humans should approve and execute**. This gives us the automation benefits (speed, consistency, 24/7 coverage) without the risk of unsupervised write actions.

### Why Not Just Use Claude Code Directly?

Claude Code is interactive — it requires a human at the keyboard. We need:

1. **Scheduled execution** — run health checks every 15 minutes without human intervention
2. **Event-driven triggers** — respond to webhooks (CI failure, PD alert) automatically
3. **Persistent state** — track what was investigated, what's pending approval, conversation history
4. **Permission boundaries** — different agents need different access levels
5. **Audit trail** — full conversation logs for debugging and accountability

## Memory: Markdown-First with FTS5 Sidecar Index

### Design Decision

Memory is stored as **plain markdown files** with YAML frontmatter, indexed by a **SQLite FTS5 sidecar** for search. This is inspired by the A-MEM (Agentic Memory) pattern but simplified for our use case.

### Why Markdown Files as Source of Truth

- **Human-readable**: Engineers can browse, edit, and version-control memory files directly
- **Git-friendly**: Diffs are meaningful, merge conflicts are resolvable
- **Agent-native**: Claude already works with markdown natively — no serialization overhead
- **Portable**: No database dependency for the primary data format
- **Debuggable**: `cat memory/shared/ci-patterns.md` tells you exactly what the agent knows

### Why FTS5 Sidecar (Not Embeddings)

- **Zero external dependencies**: SQLite FTS5 is built into SQLite, no vector DB or embedding API needed
- **Deterministic**: Same query always returns same results (no embedding model drift)
- **Fast enough**: For hundreds of notes, FTS5 keyword search is sub-millisecond
- **Cheap**: No embedding API costs, no vector storage costs
- **Good enough**: For operational notes (structured, keyword-rich), BM25 keyword matching works well. We're not doing semantic search over novels.

Embeddings can be added later if keyword search proves insufficient, but for a system with ~100-1000 notes about CI failures, deployment patterns, and operational procedures, FTS5 is the right starting point.

### Memory Structure

```
data/memory/
├── shared/                    # Cross-agent knowledge
│   ├── MEMORY.md             # Shared context loaded for all agents
│   ├── ci-patterns.md        # Common CI failure patterns
│   ├── cluster-health.md     # Known cluster issues
│   └── .index.sqlite         # FTS5 index (gitignored)
└── agents/
    ├── ci-fixer/
    │   ├── MEMORY.md         # CI fixer's private context
    │   └── recent-fixes.md   # Recent fixes applied
    └── health-checker/
        └── MEMORY.md         # Health checker's private context
```

### Indexer Design

The indexer parses markdown files, extracts frontmatter metadata (title, tags, date), and upserts into a FTS5 virtual table:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS notes USING fts5(
  path, title, tags, body, mtime UNINDEXED
);
```

Runs at worker startup and after each agent session completes. Incremental: tracks `mtime` per file, skips unchanged files.

### Context Injection

Before each agent session, `buildMemoryContext()`:

1. Reads the agent's private `MEMORY.md`
2. Reads the shared `MEMORY.md`
3. Runs FTS5 search using keywords from the job prompt
4. Returns top-5 results, truncated to ~4000 tokens
5. Injected into the system prompt as `## Relevant Memory`

### Security: FAILSAFE_SCHEMA

gray-matter (YAML frontmatter parser) must be configured with `FAILSAFE_SCHEMA` to prevent YAML code injection via `!!js/function` tags. This is critical since agents write memory files — a compromised agent could inject executable YAML.

## Claude Agent SDK: Why It's the Right Foundation

### What It Provides

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) is Anthropic's official framework for building autonomous agents. It provides:

- **Tool execution loop**: Handles the prompt → tool call → tool result → continue cycle
- **Built-in tools**: Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch, Task (sub-agents)
- **Permission hooks**: `canUseTool` callback for each tool invocation — we implement our 3-tier system here
- **Streaming**: Message-by-message iteration for real-time logging
- **Turn limits**: `maxTurns` prevents runaway agents
- **Sub-agents**: `Task` tool spawns child agents that inherit the parent's context

### Why Not Build Our Own Tool Loop

- **Correctness**: Tool execution has edge cases (parallel tool calls, error handling, context management). The SDK handles these.
- **Maintenance**: As Claude's API evolves, the SDK stays compatible. Our custom loop would need constant updates.
- **Features**: Sub-agents, streaming, and the built-in tool implementations are battle-tested.
- **Focus**: We want to build the operational system (queue, permissions, memory), not reinvent the agent loop.

### Why Not Use a Framework (LangChain, Mastra, VoltAgent)

- **Overhead**: Frameworks add abstractions we don't need. Our worker loop is simple: claim job → run agent → log result.
- **Lock-in**: Framework-specific patterns make it harder to switch or customize.
- **Claude-native**: The Agent SDK is designed specifically for Claude's tool-use patterns. Generic frameworks add translation layers.
- **Birmel experience**: birmel uses Mastra/VoltAgent, which adds complexity. For a system that's purely Claude-powered, the SDK is more direct.

## Security: 3-Tier Permission Model

### Design Principles

1. **Default deny**: If a tool/command isn't explicitly allowed, it requires approval
2. **Least privilege**: Each agent gets the minimum tools it needs
3. **Human-in-the-loop for writes**: No unsupervised write actions
4. **Audit everything**: Every tool call is logged in the JSONL conversation history

### Tier 1: Auto-Allow (Read-Only Tools)

These tools are always allowed for all agents:

- `Read` — read file contents
- `Glob` — find files by pattern
- `Grep` — search file contents
- `WebSearch` — search the web
- `WebFetch` — fetch URL content

These are safe because they're read-only and can't modify state.

### Tier 2: Bash Allowlist (Safe Commands)

Bash commands are matched against an explicit allowlist. Each entry specifies the executable and allowed argument patterns:

```typescript
const ALLOWED_COMMANDS = [
  {
    command: "gh",
    subcommands: ["run list", "pr view", "pr list", "issue list"],
  },
  { command: "kubectl", subcommands: ["get", "describe", "logs"] },
  { command: "argocd", subcommands: ["app list", "app get"] },
  { command: "talosctl", subcommands: ["health", "dashboard"] },
  { command: "git", subcommands: ["log", "status", "diff", "show"] },
  { command: "bun", subcommands: ["run typecheck", "run test"] },
  { command: "bunx", subcommands: ["eslint"] },
];
```

**Critical security note**: Commands are parsed as argv tokens, not matched with regex. Shell metacharacters (`;|&$\`()><\n`) in any argument cause immediate rejection. This prevents injection attacks like`gh pr view 123; rm -rf /`.

### Tier 3: Approval Queue (Everything Else)

Any tool call not covered by Tier 1 or Tier 2 goes to the approval queue:

1. Worker creates an `ApprovalRequest` in the database
2. Discord embed sent with full tool name and raw input (never truncated)
3. Approve/deny buttons + fallback slash command
4. Worker blocks until decision (configurable timeout, default 30 minutes)
5. On timeout: auto-deny

### Sub-Agent Security

The `Task` tool (which spawns sub-agents) is **not** Tier 1. Sub-agents must inherit the parent's permission tier and `canUseTool` handler. This prevents privilege escalation — a read-only agent can't spawn a sub-agent with write access.

## Architecture: Type-Safe TypeScript Agent Definitions

### Agent Definition Pattern

Each agent is defined as a typed object, not a class. This keeps definitions declarative and easy to review:

```typescript
export const ciFixer: AgentDefinition = {
  name: "ci-fixer",
  description:
    "Investigates and fixes CI failures on main and release-please branches",
  systemPrompt: `You are a CI investigation agent...`,
  tools: ["Read", "Glob", "Grep", "Bash", "WebFetch"],
  maxTurns: 30,
  permissionTier: "write-with-approval",
  triggers: [
    { type: "cron", schedule: "*/30 * * * *", prompt: "Check CI status..." },
    {
      type: "webhook",
      source: "github",
      event: "workflow_run.completed",
      filter: "conclusion=failure",
      promptTemplate: "CI run {{id}} failed...",
    },
  ],
  memory: { private: "agents/ci-fixer", shared: ["shared"] },
};
```

### Registry Pattern

All agent definitions are imported into a registry map:

```typescript
// src/agents/registry.ts
import { ciFixer } from "./ci-fixer.js";
import { healthChecker } from "./health-checker.js";

export const agents = new Map<string, AgentDefinition>([
  [ciFixer.name, ciFixer],
  [healthChecker.name, healthChecker],
]);
```

The worker, adapters, and CLI all use this registry to look up agent definitions.

### Why Not Dynamic Agent Loading

Agents are statically imported because:

- **Type safety**: TypeScript checks all agent definitions at compile time
- **Reviewability**: All agent definitions are visible in code review
- **No runtime surprises**: No dynamic `import()` or file system scanning
- **Simple**: A Map is the simplest correct data structure

## Ingress: SQLite Job Queue (Start Simple)

### Why SQLite, Not Redis/RabbitMQ/SQS

- **Single process**: Sentinel runs as one worker (initially). No distributed coordination needed.
- **Persistent**: Jobs survive restarts without external infrastructure.
- **Transactional**: SQLite ACID guarantees prevent double-processing.
- **Zero ops**: No Redis server to monitor, no connection pooling to configure.
- **Already using it**: Prisma + SQLite for approval requests and session tracking. Same database.

### Atomic Claim Pattern

The critical operation is claiming a job without races:

```sql
UPDATE Job SET status = 'running', claimedAt = NOW()
WHERE id = (
  SELECT id FROM Job
  WHERE status = 'pending'
  ORDER BY priority ASC, createdAt ASC
  LIMIT 1
)
RETURNING *;
```

Single atomic query — no SELECT-then-UPDATE race condition. WAL mode + busy_timeout handles concurrent access if we add workers later.

### Why Not a More Sophisticated Queue

- **YAGNI**: One worker processing one job at a time doesn't need backpressure, partitioning, or consumer groups.
- **Upgrade path**: If we outgrow SQLite, migrating to PostgreSQL (same Prisma schema, different provider) is straightforward.
- **Observability**: `SELECT * FROM Job WHERE status = 'pending'` is easier to debug than checking RabbitMQ management UI.

## Determinism: When to Use Agents vs Code

### Guiding Principle

Use an agent (LLM) when the task requires **judgment, interpretation, or adaptation**. Use deterministic code when the task is **mechanical and predictable**.

### Agent Tasks (LLM Required)

- Investigating CI failures (reading logs, understanding errors, proposing fixes)
- Triaging PagerDuty alerts (assessing severity, correlating with recent changes)
- Summarizing findings in natural language for Discord notifications
- Deciding which files to read, which commands to run, what to investigate next

### Deterministic Code Tasks

- Job queue operations (enqueue, claim, complete, fail)
- Cron scheduling
- Webhook payload parsing and routing
- Permission checking (allowlist matching)
- JSONL logging
- FTS5 indexing
- Discord embed formatting

### Anti-Pattern: Using Agents for Mechanical Work

Don't use an agent to "parse this JSON webhook payload and extract the workflow run ID". That's a deterministic operation — write a function. Save the agent for "analyze this CI failure and determine root cause".

## Long-Running Sessions: Anthropic's Harness Pattern

### The Problem

Agent sessions can run for minutes (complex CI investigation) or get stuck waiting for approval. The worker needs to handle:

- **Timeouts**: Kill sessions that exceed wall-clock limits
- **Cancellation**: Stop sessions when jobs are cancelled
- **Graceful shutdown**: Finish current session before process exit

### The Pattern

Wrap each agent session in a harness:

```typescript
async function runAgentSession(
  job: Job,
  agentDef: AgentDefinition,
): Promise<SessionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    agentDef.maxDurationMs ?? 600_000,
  );

  try {
    const session = createSession({
      prompt: job.prompt,
      systemPrompt: buildSystemPrompt(agentDef, job),
      tools: agentDef.tools,
      maxTurns: agentDef.maxTurns,
      canUseTool: buildPermissionHandler(agentDef, job),
      signal: controller.signal,
    });

    for await (const message of session) {
      appendToJSONL(job, message);
      updateSessionMetrics(session.id, message);
    }

    return { status: "completed", result: session.result };
  } catch (error) {
    if (controller.signal.aborted) {
      return { status: "timeout", error: "Session exceeded time limit" };
    }
    return { status: "failed", error: String(error) };
  } finally {
    clearTimeout(timeout);
  }
}
```

### Graceful Shutdown

The main process listens for SIGTERM/SIGINT:

1. Stop accepting new jobs (don't claim from queue)
2. Wait for current session to complete (with a grace period)
3. If grace period exceeded, abort the session
4. Close database connections, flush logs
5. Exit

This matches the pattern used in `packages/birmel/src/index.ts`.

## Summary Architecture

```
                    ┌─────────────────────────────────────────┐
                    │              Ingress Layer               │
                    │                                          │
                    │  ┌──────┐  ┌─────────┐  ┌───────────┐  │
                    │  │ Cron │  │Webhooks │  │  Discord  │  │
                    │  │      │  │ (Hono)  │  │ Commands  │  │
                    │  └──┬───┘  └────┬────┘  └─────┬─────┘  │
                    └─────┼───────────┼─────────────┼─────────┘
                          │           │             │
                          ▼           ▼             ▼
                    ┌─────────────────────────────────────────┐
                    │          SQLite Job Queue                │
                    │  (Prisma + WAL mode + atomic claims)    │
                    └──────────────────┬──────────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────────┐
                    │              Worker Loop                 │
                    │                                          │
                    │  claim job → lookup agent → run session  │
                    │                                          │
                    │  ┌──────────────────────────────────┐   │
                    │  │     Claude Agent SDK Session      │   │
                    │  │                                    │   │
                    │  │  prompt → tool calls → results    │   │
                    │  │         ↕                          │   │
                    │  │  ┌────────────────────────────┐   │   │
                    │  │  │   Permission System         │   │   │
                    │  │  │   Tier 1: auto-allow reads  │   │   │
                    │  │  │   Tier 2: bash allowlist    │   │   │
                    │  │  │   Tier 3: approval queue    │   │   │
                    │  │  └────────────────────────────┘   │   │
                    │  └──────────────────────────────────┘   │
                    └──────────────┬──────────────────────────┘
                                   │
                    ┌──────────────┼──────────────────────────┐
                    │              │  Output Layer             │
                    │              ▼                            │
                    │  ┌────────┐  ┌────────┐  ┌──────────┐   │
                    │  │  JSONL │  │Discord │  │  Memory  │   │
                    │  │  Logs  │  │Notifs  │  │  Notes   │   │
                    │  └────────┘  └────────┘  └──────────┘   │
                    └─────────────────────────────────────────┘
```

## Sources and References

- **Claude Agent SDK**: `@anthropic-ai/claude-agent-sdk` — Anthropic's official agent framework
- **A-MEM pattern**: Agentic Memory for LLM agents — markdown-first memory with structured indexing
- **SQLite FTS5**: Full-text search extension, built into SQLite
- **Prisma**: TypeScript ORM with SQLite support
- **Hono**: Lightweight HTTP framework for webhooks
- **discord.js**: Discord bot library (same as birmel)
- **gray-matter**: YAML frontmatter parser for markdown files
- **pino**: Structured JSON logger
- **Sentry + OpenTelemetry**: Observability stack (same as birmel)
- **cron**: Cron scheduling library (same as scout-for-lol)
- **Monorepo patterns**: birmel (`packages/birmel/`) and scout-for-lol (`packages/scout-for-lol/`) as reference implementations
