---
name: monorepo-docs
description: Decide where repository documentation belongs and author the human-facing Starlight wiki. Use for package READMEs, architecture explanations, operator how-tos, or changes under packages/docs/wiki.
---

# Monorepo documentation

Choose the durable owner before writing:

- Package purpose, public API, contributor commands, and code layout: package
  `README.md`.
- Always-on agent constraints: the nearest concise `AGENTS.md`.
- Repeatable agent procedure: `.agents/skills/<id>/SKILL.md`.
- Human architecture, rationale, or operator workflow:
  `packages/docs/wiki/src/content/docs/`.
- Plans, follow-ups, status, and review queues: Linear or the PR.

For wiki work, read `packages/docs/wiki/AGENTS.md` and use Diátaxis. Every page
is exactly one kind:

- tutorial: learning through a complete exercise;
- how-to: steps toward a known outcome;
- reference: scannable facts and contracts;
- explanation: rationale, relationships, and tradeoffs.

Use `title` and `description` frontmatter, no Markdown H1, kebab-case filenames,
and absolute wiki routes. Link source files that prove system claims. Do not
copy inventories, flags, commands, or procedures across pages.

Verify with the wiki's typecheck, test, build, and E2E scripts. Inspect changed
pages at desktop and mobile widths and attach a screenshot to the PR when the
rendered page changed.
