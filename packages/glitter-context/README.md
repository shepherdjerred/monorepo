# Glitter Context

`@shepherdjerred/glitter-context` is the canonical, language-neutral source for
Glitter people, style cards, relationship history, current relationships, lore,
and derived-data generation state.

The canonical data lives under `data/` as JSON and is described by JSON Schema.
TypeScript consumers import the built package, whose generated source contains
the validated JSON inline and performs no runtime filesystem reads. Python
validation is provided by `python/validate_context.py`.

Relationship facts are append-only events. Historical events remain queryable;
the current graph is projected from events whose status is `current`.

## Just-in-time friend context

Use `getFriendContext` to retrieve prompt-ready context for one message without
injecting the complete history or any style-card corpus:

```ts
import { getFriendContext } from "@shepherdjerred/glitter-context";

const context = getFriendContext({
  message: "What happened with Gex and NekoRyan in Vancouver?",
  mentionedDiscordUserIds: [],
  characterBudget: 8000,
  maxLoreSections: 6,
});

console.log(context.contextText);
```

`contextText` is the only prompt-ready projection and never exceeds
`characterBudget`. The result also exposes typed resolution, relationship, and
lore-section records for provenance and testing. Name and alias matches are
exact inside message text; `resolvePersonReference` additionally provides
deterministic prefix matching with explicit `matched`, `ambiguous`, and
`unmatched` results. Lore is split into stable timeline sections, ranked by
person and lexical relevance, deduplicated, and included whole rather than
silently clipped.

## Weekly refresh

Temporal's paused-by-default `glitter-context-refresh-weekly` schedule reads
only a complete, checksum-verified snapshot mirrored in SeaweedFS and R2. It
refreshes a card after 20 new messages or 90 days, validates GPT-5.6 Sol structured
output, and opens one human-reviewed pull request. Raw samples must be
attachment-free, mention-free, URL-free, short, and copied verbatim from the
verified projection.

Relationship proposals require explicit corpus evidence IDs. Superseded
same-kind events become `historical`; they are never deleted. The workflow can
change only `data/generation-state.json`, `data/relationships.json`,
`data/style-cards/*_style.json`, and the generated bundled-data source.
