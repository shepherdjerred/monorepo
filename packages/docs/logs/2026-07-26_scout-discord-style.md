---
id: log-2026-07-26-scout-discord-style
type: log
status: complete
board: false
---

# Scout Discord Style

## Question

Determine whether Scout uses the same Discord-oriented conversational style or
persona machinery as Birmel.

## Findings

- Scout uses named friend-group personalities, including Virmel, when generating
  AI postmatch reviews. The live backend loads the personality instructions,
  random behaviors, and required style card, then injects them into the review
  system prompt with the shared Glitter Boys history and relationship graph.
- This persona mechanism is scoped to Scout's AI review pipeline. Scout's
  ordinary Discord command responses are not globally rewritten into Virmel's
  voice.
- Birmel uses the same underlying idea for its general conversational persona.
  Virmel is the default, and Birmel injects selected voice characteristics,
  style markers, sample messages, and the same friend-group lore into its
  supervisor and specialist-agent prompts.
- The two packages do not consume a shared source of truth. They keep separate
  copies of the style cards and lore. The two lore files are currently
  byte-identical, while the overlapping style cards have drifted: 9 names
  overlap, only 3 cards are identical, and the Virmel cards differ slightly.

## Related Plans and Follow-ups

- `plans/2026-04-25_shared-glitter-context-package.md` is an active, planned
  extraction of both style cards and Glitter Boys lore into a shared
  `packages/glitter-context` package. It has not been implemented.
- `plans/2026-06-13_discord-style-cards-extraction-daily-pipeline.md` is an
  active, in-progress, more ambitious plan for a canonical
  `packages/discord-style-cards` package, a TypeScript generator, and a daily
  Temporal workflow that opens human-reviewed update PRs. The target package
  and workflow are absent from the current tree, and parts of the plan's setup
  and dependency guidance are stale relative to current root instructions.
- `archive/completed/2026-05-17_prove-personality-glitter-wiring.md` completed
  prompt-construction tests for Scout and Birmel, added Scout's S3 trace
  inspector, and fixed the malformed Virmel card that had disabled Birmel's
  default persona.
- `archive/completed/2026-06-02_birmel-conversational-trigger-memory.md`
  completed persona-aware conversational triggering, transcript context, and
  persona-scoped memory for Birmel.
- `plans/2026-07-03_scout-ai-review-context.md` is an adjacent
  `awaiting-human` plan that enriches Scout's personality-written reviews with
  player history and patch context.
- `todos/birmel-tests-polish.md` still tracks agent-delegation, persona
  injection, and full Discord happy-path integration coverage.

## Session Log — 2026-07-26

### Done

- Traced Scout's production AI-review prompt path from personality selection
  through postmatch review generation.
- Compared Scout and Birmel persona assets and confirmed the duplicated,
  partially drifted Virmel style-card setup.
- Audited active, completed, and awaiting-human plans plus the related Birmel
  testing TODO.

### Remaining

- None for the repository-backed question.

### Caveats

- Findings are based on the current source tree; no live Discord review was
  generated during this read-only investigation.
- The two active extraction plans overlap but are not formally linked as
  superseding one another. The April plan also centralizes lore; the June plan
  goes deeper on style-card generation and automated refresh.
