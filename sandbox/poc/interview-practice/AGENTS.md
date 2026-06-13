# interview-practice

AI-powered interview practice CLI with realistic FAANG interviewer simulation.

## Commands

```bash
interview-practice leetcode start --difficulty medium --lang java [--voice] [--time 25]
interview-practice system-design start [--voice] [--time 45]
interview-practice leetcode resume <session-id>
interview-practice questions list [--type leetcode] [--difficulty hard]
```

## Architecture

- Dual-model architecture: fast conversation model + accurate background reflection model
- Reflection queue: in-memory `Reflection[]` — reflection model pushes, conversation model drains at turn start
- Context builder assembles prompts with token budgets: persona (1000), timer+question (600), reflections (400), transcript (2000), code (500)
- `pause_and_think` tool: synchronous front-loaded call to reflection model before responding
- `next_move` structured payloads enable deterministic part advancement without model judgment
- Conversation model builds context with token budgets, calls tools (run_tests, reveal_next_part, give_hint, pause_and_think)
- Tests are ALWAYS hidden from user. AI hints verbally but never reveals test cases.
- Starter code generated from function signature + per-language templates
- SQLite for archival only (transcript, events). Live state is in-memory.
- Timer tracks elapsedMs (crash-safe), not wall clock.

## Key env vars

```
AI_PROVIDER=anthropic|openai|google
CONVERSATION_MODEL=claude-haiku-4-5-20251001    # fast conversation
REFLECTION_MODEL=claude-sonnet-4-6-20260217     # accurate background reflection
ANTHROPIC_API_KEY=...
```

## Verification

```bash
bun run typecheck
bun test
bunx eslint . --fix
```

## Design Rules

- All problems use function-call testing (direct import + deep equality), not stdin/stdout
- Question bank uses function signature schema + templates, not hand-authored starter code per language
- Scoring rubric has anchored levels (1-4 with concrete descriptions)
- `reveal_next_part` uses structured `transitionCriteria`, not AI judgment
- Excalidraw integration reads semantic extraction (components + connections), not raw JSON
