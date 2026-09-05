---
name: reflect
description: "Audit agent behavior and configuration when the user asks to reflect on a conversation, improve agent…"
---

# Reflect on agent configuration

Diagnose repeated behavior from evidence, then put the smallest durable fix in
the correct layer. Do not turn one awkward exchange into a universal rule.

## Inspect first

1. Read the relevant conversation or bounded history excerpt.
2. Read the active global, root, and nearest nested `AGENTS.md` hierarchy.
3. Inventory applicable skills, client adapters, hooks, MCPs, and permissions.
4. Identify the mismatch between intended and observed behavior. Separate
   missing context, bad routing, unclear authority, stale facts, tool failure,
   and model judgment.
5. Check whether the behavior is already enforced in code or tests. Do not add
   prose for a mechanically guaranteed rule.

## Choose the owner

- Personal, always-on preference across repositories: global `AGENTS.md`.
- Repository-wide, non-obvious invariant: root `AGENTS.md`.
- Package-only invariant or dangerous trap: nested `AGENTS.md`.
- Repeatable, task-triggered procedure: a skill.
- Human architecture or rationale: README or Diátaxis wiki.
- Deterministic safety or shape requirement: code, schema, lint, hook, or test.
- Temporary plan, follow-up, or review queue: work tracker or PR.
- Client compatibility: symlink or tiny pointer, never another prose copy.

For homelab-first repositories, state the deployment boundary precisely:
first-party hosted workloads use the repo-owned infrastructure and GitOps path;
native clients, extensions, libraries, packages, and external services do not.

## Budget and quality

Treat entrypoints as routing context, not handbooks:

- global and root `AGENTS.md`: at most 200 lines and 16 KiB;
- nested maintained `AGENTS.md`: at most 120 lines and 8 KiB;
- repository or runtime `SKILL.md`: at most 160 lines and 12 KiB;
- a discoverable repository skill catalog: at most 8 KiB of names and
  descriptions.

Preserve purpose, ownership boundaries, dangerous traps, focused commands, and
acceptance requirements. Move API reference, topology, runbooks, and historical
detail to their durable owners. Delete guidance that is stale, duplicated,
obvious, or no longer package-specific.

Skill names use lowercase kebab-case and match their directories. Descriptions
must make routing clear without exhaustive lists. Keep conditional detail in
references and read it only when relevant.

## Recommend or implement

For each proposed change, cite the observed behavior it corrects and explain
why the chosen layer owns it. Preserve the user's scope and do not broaden
permissions. If asked to implement, make focused edits, run the repository's
guidance validator, and test discovery in the clients actually used.

Evaluate improvement by behavior: can a fresh agent find the right instruction,
avoid contradictory copies, and complete a representative task? File size and
wording checks support that test but do not replace it.
