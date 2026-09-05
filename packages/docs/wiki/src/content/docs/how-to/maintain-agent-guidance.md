---
title: How to maintain agent guidance
description: Place agent knowledge in the correct layer, keep entrypoints bounded, and verify cross-client discovery.
sidebar:
  order: 12
---

Put each new instruction in the narrowest durable owner, then prove that a fresh
agent discovers it.

## 1. Classify the information

Choose one destination.

| The information is…                           | Put it in…                                |
| --------------------------------------------- | ----------------------------------------- |
| an always-on personal preference              | the chezmoi source for global `AGENTS.md` |
| a non-obvious repository invariant            | root `AGENTS.md`                          |
| a package-only boundary or dangerous trap     | that package's `AGENTS.md`                |
| a repeatable task procedure                   | `.agents/skills/<skill-id>/SKILL.md`      |
| package API, layout, or contributor reference | the package README                        |
| architecture rationale                        | an explanation page                       |
| an operator procedure                         | a how-to page                             |
| temporary work or a follow-up                 | Linear or the pull request                |

Do not repeat the content in a client-specific rules file.

## 2. Keep the entrypoint small

Retain purpose, ownership, dangerous traps, focused commands, and acceptance
requirements. Move conditional detail behind a reference or into durable human
documentation.

| Entrypoint                           | Maximum lines | Maximum size |
| ------------------------------------ | ------------: | -----------: |
| global or root `AGENTS.md`           |           200 |       16 KiB |
| nested maintained `AGENTS.md`        |           120 |        8 KiB |
| repository or runtime `SKILL.md`     |           160 |       12 KiB |
| skill catalog names and descriptions |             — |        8 KiB |

Delete an `AGENTS.md` when the package has no invariant beyond root guidance.
If it remains, keep its adjacent `CLAUDE.md` symlink pointed at `AGENTS.md`.

## 3. Add or change a skill

Use a lowercase kebab-case ID and the same directory name. Give `SKILL.md`
portable YAML frontmatter with a concise `name` and discriminating
`description`.

Keep task routing and essential constraints in the entrypoint. Put a substantial
mode-specific procedure in `references/` and link it at the point where an
agent should load it.

Application-owned runtime skills may remain package-local. Do not move them into
the repository catalog unless developer sessions, rather than application code,
are their consumer.

## 4. Update compatibility adapters

Use symlinks or a short pointer only.

- Root `.claude/skills` points to `../.agents/skills`.
- Global Claude and Codex instruction paths point to `~/AGENTS.md`.
- Antigravity's instruction and skill paths point to the same global sources.
- Cursor's user rule tells it to read the canonical files.
- OpenCode uses its native `AGENTS.md` and Claude-compatible discovery.

Never add repository `.cursor/rules` or a copied client skill tree.

## 5. Run the guard and focused checks

From the repository root:

```bash
bun run check-agent-guidance
bunx turbo run test typecheck lint --filter=@shepherdjerred/root-scripts
bunx turbo run test typecheck lint --filter=@shepherdjerred/dotfiles-scripts
bunx turbo run test typecheck lint --filter=@shepherdjerred/docs-wiki
```

Build the wiki and inspect changed pages at desktop and mobile widths.

When verification machinery changed, run `bun run verify`. The staged-file
pre-commit hook also runs the guidance guard for relevant paths.

## 6. Test discovery in fresh sessions

Open a new session in the home directory, repository root, and a package with
local guidance. Ask the agent which instructions and skills apply before giving
it a representative task.

Repeat this in Codex, Claude, Cursor, OpenCode, and Antigravity. Then test one
Codex session through each wrapper in use. Existing sessions may retain old
context, so they are not valid discovery tests.

Record which clients and scopes were tested. Do not describe an untested client
as compatible merely because its adapter exists.

## Related

- [Agent guidance is layered context](/explanation/agent-guidance/)
- [How this wiki works](/explanation/how-this-wiki-works/)
