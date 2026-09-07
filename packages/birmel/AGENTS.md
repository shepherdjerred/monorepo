# Birmel agent constraints

Birmel is a Discord bot with one explicit AI SDK runtime. `README.md` describes
the architecture and capability surface.

## Turn and authority boundaries

- The only turn pipeline is admission and restart-safe `AgentRun` dedup,
  `ContextBundle`, one agent with every registered tool, one edited Discord
  reply, then curated memory extraction. There is no pre-flight router: the
  agent may change approach mid-turn, and that is the point.
- Only configured trusted users may trigger the bot or any tool. Guild, channel,
  and actor identity come from `RequestContext`, never model arguments.
- The agent reports `conversation`, `supported`, or `unsupported` as an outcome
  when the turn ends, never as an up-front classification. Every tool call it
  cites in `reliedOnToolCallIds` must have actually succeeded; that check
  (`requireGroundedAnswer`) is the anti-hallucination gate and must not be
  weakened. Missing capability is an honest limitation, not a safety refusal.
- One source message gets one placeholder and one final edit. Source-channel
  tools must not send a second final response.
- Keep stable tool IDs and Zod schemas. Validate model-facing tool results.
  Tool metadata and the executable registry must stay identical; startup calls
  `getCapabilityCatalog` and refuses to boot on a mismatch.

## Context, memory, and jobs

`src/context/turn-context.ts` is the only context assembler. Never persist
assembled prompts or reasoning. Keep recent Discord and Glitter context bounded.

Durable human memory uses claims plus append-only revisions from raw human
messages. Bot text, retrieved memory, and assembled prompts are not human
evidence. Curated self-memory is limited to grounded aliases, commitments, and
successful tool experiences. Privacy erase physically deletes; forget writes a
tombstone. Runtime code must never open the legacy Mastra database.

One active session belongs to each Discord thread. `manage-job` is the only job
surface. Re-check authority at execution, claim atomically, preserve request
context, and checkpoint external effects. An ambiguous effect pauses for
operator resolution and must not be replayed in place.

## Persistence and verification

Startup fingerprints legacy SQLite state and runs `prisma migrate deploy`.
Never replace it with `db push`. `/ready` requires migrations, Prisma, Discord,
and scheduler readiness; configuration parsing is strict.

```bash
bun run build
bun run typecheck
bun run test
bun run lint
bun run docker:build
bun run smoke
```

Disconnect Prisma in test teardown. Routine tests use fake Discord, model, and
browser boundaries. Production delivery uses the existing homelab image and
ArgoCD path; verify live behavior separately.
