---
id: reference-completed-2026-06-06-xstate-skill
type: reference
status: complete
board: false
---

# Add an XState Skill

## Context

The monorepo ships ~63 agent skills under `packages/dotfiles/dot_agents/skills/` (chezmoi source for
`~/.agents/skills/`) but had **no XState skill**, despite XState being used in-repo
(`packages/discord-plays-pokemon/.../backend` pins `xstate ^5.32.0`; archived `streambot` used v5.32) and
a painful monorepo-specific gotcha (`setup({ types })` vs the `no-type-assertions` ESLint rule + the
suppression ratchet). Goal: author a comprehensive, current (mid-2026) `xstate-helper` skill mirroring
existing skill conventions, covering the newest features and best practices, with the repo-specific
typing workaround baked in.

User decisions: **Comprehensive** scope; **SKILL.md + references/** structure; **deploy live** via chezmoi.

## Library versions (verified from npm registry, 2026-06-06)

| Package               | Version |
| --------------------- | ------- |
| `xstate`              | 5.32.0  |
| `@xstate/store`       | 4.1.0   |
| `@xstate/react`       | 6.1.0   |
| `@xstate/store-react` | 2.0.0   |

## Deliverables (all shipped)

| File                                       | Purpose                                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dot_agents/skills/xstate-helper/SKILL.md` | Main skill: versions, What's New, core model, setup/createMachine, actions/guards, TS helpers, React + store summaries, **Monorepo Gotchas**, best practices                         |
| `references/actors-and-machines.md`        | Actor lifecycle, logic creators, invoke vs spawn, hierarchical/parallel/history states, after/always, raise/sendTo/emit, type-bound setup helpers, pure transitions, routable states |
| `references/react-integration.md`          | `@xstate/react` v6 hooks, `createActorContext`, selector patterns, composition, child→parent comms, 6.1.0 error-boundary behavior                                                    |
| `references/xstate-store.md`               | `@xstate/store` v4: createStore, trigger, `@xstate/store-react`, emits/effects, Immer, persist/undo/validate, atoms, fromStore                                                       |
| `references/testing-and-migration.md`      | bun:test patterns, model-based testing (`xstate/graph`), persistence, inspection, full v4→v5 cheatsheet                                                                              |

## Research performed

~50+ pages fetched via `toolkit fetch` (auto-indexed) + `gh`/`curl`, across four parallel agents:

- ~17 Stately core docs (actor-model, actors, machines, setup, context, actions, guards, invoke, spawn,
  input, output, delayed/eventless transitions, parallel/parent/final/history states).
- ~12 docs on TypeScript, testing, persistence, inspection, migration, states/transitions, cheatsheet.
- `@xstate/react` + `@xstate/store` docs, READMEs, CHANGELOGs (corrected several stale doc claims).
- Core CHANGELOG + GitHub releases for newest APIs; Stately blog, Sandro Maglione, frontendundefined,
  makersden comparison, HN sentiment.

### Newest features surfaced (with versions)

`actor.select` (5.29), routable states (5.28), `getMicrosteps`/`getInitialMicrosteps` (5.27),
`maxIterations` (5.31), `filterEvents` (5.30), type-bound `setup()` action helpers (5.22), `setup.extend`
(5.24), `createStateConfig` (5.21), `mapState`/`getNextTransitions` (5.31/5.26), partial `assertEvent`
descriptors (5.25), model-based testing moved into `xstate/graph` (5.20), `@xstate/store` v3/v4
(`store.trigger`, `persist`, atoms, schema validation, `@xstate/store-react` split).

## Verification (done)

- **Flagship gotcha proven** against `xstate@5.32.0` in a throwaway dir: the holder-variable typing
  pattern compiles clean with the event union + state values intact; the inline-phantom pitfall was
  confirmed to collapse the union (rejecting `PLAY`/`STOP`). Scratch dir removed.
- **Frontmatter** parses; `name: xstate-helper` + `description: |` block matches sibling skills.
- **Live deploy**: `chezmoi apply --source <worktree>/packages/dotfiles ~/.agents/skills/xstate-helper`
  succeeded; live files match worktree source.

## Out of scope

- Adding XState as a dependency to any package / writing production machines.
- Modifying the `no-type-assertions` rule or the ratchet.
