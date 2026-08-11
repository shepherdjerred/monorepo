# Birmel

Discord bot built on a single explicit AI SDK agent runtime. Every message turn
follows one pipeline: a Discord event is admitted (trusted users only),
assembled into a context bundle, routed to either tool-free direct conversation
or exactly one tool-running specialist (`messaging`, `server`, `moderation`,
`music`, `automation`, or `editor`), and answered with one edited Discord
reply. On top of that runtime the bot keeps durable memory as revisioned
claims, binds one active session to each Discord thread, runs a jobs system
with durable effect checkpoints, and plays music through discord-player.
Health is exposed on `/live` (process) and `/ready` (migrations applied,
Prisma connected, Discord ready, scheduler started).

## Commands

Run from `packages/birmel`:

```bash
bun run dev          # build glitter context, generate Prisma, apply migrations, watch-run src/index.ts
bun run start        # production startup path (scripts/start.ts): migrate deploy, then run the bot
bun run build        # bundle src/index.ts to dist/
bun run test         # generate Prisma against .env.test, then bun test
bun run typecheck    # tsc --noEmit (generates Prisma first)
bun run lint         # eslint (generates Prisma first)
bun run smoke        # image smoke test (scripts/smoke.ts)
```

End-to-end checks are separate scripts: `bun run test:e2e:music`,
`bun run test:e2e:youtube-stream`, and `bun run test:e2e:openclaw-docker`.

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

The image includes `gh`, Claude Code, Node, Python, yt-dlp, and ffmpeg for the
editor and music specialists. Production deploys go through the Buildkite
image build and ArgoCD GitOps flow.

See [AGENTS.md](AGENTS.md) for contributor/agent workflow notes.
