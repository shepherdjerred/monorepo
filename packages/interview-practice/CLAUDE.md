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

- Phase 1 (current): Single conversation model (Sonnet), in-memory state, text input
- Conversation model builds context with token budgets, calls tools (run_tests, reveal_next_part, give_hint)
- Tests are ALWAYS hidden from user. AI hints verbally but never reveals test cases.
- Starter code generated from IO schema + per-language templates
- SQLite for archival only (transcript, events). Live state is in-memory.
- Timer tracks elapsedMs (crash-safe), not wall clock.

## Key env vars

```
AI_PROVIDER=anthropic|openai|google
CONVERSATION_MODEL=claude-sonnet-4-6-20260217
ANTHROPIC_API_KEY=...
```

## Verification

```bash
bun run typecheck
bun test
bunx eslint . --fix
```

## Design Rules

- All problems use stdin/stdout IO model (language-agnostic)
- Question bank uses IO schema + templates, not hand-authored starter code per language
- Scoring rubric has anchored levels (1-4 with concrete descriptions)
- `reveal_next_part` uses structured `transitionCriteria`, not AI judgment
- Excalidraw integration reads semantic extraction (components + connections), not raw JSON
