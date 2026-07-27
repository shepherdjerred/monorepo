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
