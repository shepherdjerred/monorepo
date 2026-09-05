# Sentinel POC constraints

Sentinel is a sandbox experiment for queued operational agents. It may
investigate and propose; a human approves external writes.

- SQLite/Prisma owns the priority job queue.
- Workers claim jobs durably before starting an agent session.
- Read tools may be automatic. Shell and external mutations follow the
  allowlist and approval queue; model text never grants itself authority.
- Conversation logs are private runtime data and must not enter Git.
- Keep POC dependencies, credentials, and patterns isolated from production
  packages unless intentionally redesigned and reviewed.

```bash
bun run typecheck
bun run test
bun run lint
```
