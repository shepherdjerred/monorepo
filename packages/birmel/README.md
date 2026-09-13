# Birmel

Discord bot built on a single explicit AI SDK agent runtime. Every message turn
follows one pipeline: a Discord event is admitted (trusted users only),
assembled into a context bundle, and handed to one agent that works the request
to a conclusion. The agent sees every registered tool and decides as it goes,
so investigating and then changing approach is normal rather than an error.
It finishes with a structured answer carrying the turn's disposition.

While it works, the turn narrates into the single Discord reply it owns: a
throttled timeline of what ran, with the agent's own one-line description of
what it is doing, resolving to the answer. Progress edits are best-effort and
never persisted.

There is deliberately no up-front router. Routing used to pick one specialist
and one primary tool from assembled context alone, before any tool could run,
and required that pre-named tool to succeed - so an ordinary "this needs a
different tool" became a failed turn. The turn's disposition (`conversation`,
`supported`, `unsupported`) is now reported by the agent on the way out, which
is the only point at which it is actually known.

Durable memory separates human claims from curated
self-memory: accepted aliases, commitments, and experiences backed by a
specific successful current-turn tool call and its bounded, redacted result.
Aliases and persona memory cross trusted
users and channels within one guild, never across guilds. Learned aliases need
an explicit proposal, explicit acceptance, and a bounded wake-name shape; the
general human-claim path cannot create them. Their whitespace and Unicode word
boundaries are canonical, and per-channel admission preserves immediate
follow-up order without queuing full agent turns; the queue is bounded and
untrusted traffic never enters it. Negated proposals or rejections never create
aliases. The bot exposes no generic SQL
tool; scoped activity questions use the activity capability. Commitments retain
an exact commitment excerpt from the delivered reply and a grounded stable
topic, so unrelated promises do not overwrite each other.

The runtime also binds one active session to each Discord thread and runs a
jobs system with durable effect checkpoints. Health is exposed on `/live`
(process) and `/ready` (migrations applied, Prisma connected, Discord ready,
scheduler started).

## Commands

Run from `packages/birmel`:

```bash
bun run dev          # build glitter context, generate Prisma, apply migrations, watch-run src/index.ts
bun run start        # production startup path (scripts/start.ts): migrate deploy, then run the bot
bun run build        # bundle src/index.ts to dist/
bun run test         # generate Prisma against .env.test, then bun run test
bun run typecheck    # tsc --noEmit (generates Prisma first)
bun run lint         # eslint (generates Prisma first)
bun run smoke        # image smoke test (scripts/smoke.ts)
```

End-to-end capability checks run through `bun run test:e2e:openclaw-docker`.

## Prisma

The schema lives at `prisma/schema.prisma` with versioned migrations in
`prisma/migrations`. `bun run generate` (invoked automatically by the build,
dev, test, typecheck, and lint scripts) runs `scripts/generate-prisma.ts`, a
lock-guarded `prisma generate`. Storage is SQLite through
`@prisma/adapter-libsql`; startup (`scripts/start.ts`) fingerprints an existing
unmigrated database, resolves the verified baseline when appropriate, and runs
`prisma migrate deploy` before starting the bot.

## Docker

```bash
bun run docker:build   # builds birmel:dev from the repo root context (Dockerfile)
```

The image is the Bun runtime plus the scoped source closure — it installs no
CLIs or extra language runtimes. Production deploys go through the Buildkite
image build and ArgoCD GitOps flow.

See [AGENTS.md](AGENTS.md) for contributor/agent workflow notes.
