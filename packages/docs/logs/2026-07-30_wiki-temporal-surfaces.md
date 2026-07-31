---
id: log-2026-07-30-wiki-temporal-surfaces
type: log
status: in-progress
board: false
---

# Wiki: document the temporal surfaces

Session goal: write the first real content section of the human wiki
(`packages/docs/wiki/`) — a curated page (or small set of pages) documenting
the surfaces of `packages/temporal`: workflows, schedules, the agent-task
scheduler (`temporal-agent-task` doc blocks, `schedule-agent-task.ts`, the
authenticated `/agent-tasks` HTTP API), deployment shape, and how the rest of
the repo integrates with it.

## Approach

1. Explore agent maps every temporal surface (workflows, schedules, API,
   worker/deployment, CLI scripts, UI, cross-package integration).
2. Decide page structure (likely one focused curated page under
   `src/content/docs/`, Mermaid diagram for the task lifecycle).
3. Worktree + git-spice branch, author page, run wiki verification
   (`typecheck`, `test`, `build`, `test:e2e`), screenshot for PR.

## Session Log — 2026-07-30

### Done

- Explored every surface of `packages/temporal` (workflows, schedules, agent
  tasks, webhooks, HA bridge, deployment) and spot-verified the load-bearing
  facts against the live tree (report-only mode enum, port 9467,
  `POST /agent-tasks`, ~31 schedules, 7 worker queues).
- Authored the first real wiki section: `packages/docs/wiki/src/content/docs/temporal/`
  — `index.md` (overview + system map), `schedules.md`, `agent-tasks.md`,
  `events.md` — and added the `Temporal` sidebar group in `astro.config.ts`.
- Verified per `wiki/AGENTS.md`: `typecheck`, `test`, `build`, `test:e2e` all
  pass; inspected rendered pages at 1280px and 390px; reworked the agent-task
  diagram from LR to TD after the first render was illegibly small.
- Liveness-checked all five GitHub source links (200).
- Draft PR #1869 with desktop screenshots of all four pages + a mobile shot,
  uploaded via `toolkit pr asset`.

### Remaining

- Promote PR #1869 from draft once Buildkite CI is green and the review gate
  passes.

### Caveats

- Deliberately omitted from the public pages: the tailnet FQDN for the
  Temporal Web UI ("Tailscale-gated" instead) and 1Password item IDs. The
  `sjer.red` tunnel hostnames are included — they are already in the public
  repo and auth-gated.
- The schedules page describes categories and mechanics, not the full
  schedule table — `packages/temporal/AGENTS.md` and `register-schedules.ts`
  stay the source of truth, so the wiki page won't drift with every schedule
  add/remove.
