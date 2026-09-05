# Interview-practice POC constraints

This sandbox POC is an AI interview-practice CLI. Keep experiments local to
this directory and do not promote its provider or architecture choices to
repository policy.

- A fast conversation model and slower reflection model have distinct roles.
  Reflection enters the next turn through the bounded context builder.
- `pause_and_think` is an explicit synchronous reflection tool.
- Part advancement uses structured `next_move` and `transitionCriteria`, not
  unstructured model judgment.
- Tests are hidden from the interviewee. Hints may explain concepts but never
  reveal cases or expected outputs.
- Coding problems use function-call testing and language templates.
- SQLite is archival; live session state is in memory. The timer persists
  elapsed duration rather than depending on wall-clock timestamps.
- Excalidraw analysis uses semantic components and connections, not raw JSON.

```bash
bun run typecheck
bun run test
bun run lint
```
