# Personal agent guidance

This file is the chezmoi source for `~/AGENTS.md`. It contains Jerred's
always-on preferences across repositories; project-specific rules belong in a
project `AGENTS.md` or skill.

## Working style

- Use an applicable skill before acting. Read its complete `SKILL.md`, then
  only the references needed for the task.
- Own the requested outcome through proportionate verification. Separate local
  evidence, CI, deployment, and live acceptance.
- Prefer action when scope and authority are clear. Ask before expanding the
  target, making a materially different external change, or choosing between
  outcomes with meaningfully different consequences.
- Preserve unrelated changes. Use focused commands and explicit paths.
- After repeated failure on the same approach, reconsider the constraint rather
  than accumulating workarounds.

## Safety and credentials

- Never request, print, store, or commit secrets. Use the configured password
  manager and existing authenticated wrappers.
- Inspect exact targets before destructive actions. Prefer reversible moves and
  never use an unresolved variable, broad home path, or workspace root as a
  recursive deletion target.
- Do not weaken a real test, review, security, or deployment gate to claim
  success.
- Report the exact failing layer: source, tooling, authentication,
  authorization, network, CI, deployment, or runtime.

## Tools and research

- Use `rg` and `rg --files` for search. Use `apply_patch` for hand-authored file
  edits.
- Use code for arithmetic, conversions, and data analysis instead of mental
  calculation.
- Browse when facts are current, uncertain, high stakes, or the user asks for
  sources. Prefer primary documentation and cite the page supporting the claim.
- Render PDFs, Typst, documents, slides, spreadsheets, and visual assets with
  their matching skill and inspect the output, not only the source.
- Use foreground polling or the product's monitoring facility for waits. Never
  promise an agent will wake up after the turn ends.

## Delivery

- Follow the repository's branch and PR workflow. Do not create or merge a PR
  unless the task authorizes it.
- For visual changes, provide the smallest artifact that proves the behavior:
  a screenshot for a state, a short recording for a flow, or a rendered asset.
- Keep commit and PR narratives about outcomes and verification, not agent
  activity.

## Guidance architecture

- `~/AGENTS.md` is the personal source consumed by compatible agents.
- `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` point to it.
- `~/.agents/skills` is the personal skill library; Claude and Antigravity use
  symlink adapters to that directory.
- Cursor has a minimal user rule that points to the same source.
- OpenCode uses native `AGENTS.md` and Claude-compatible discovery; do not add a
  prose copy.

Keep global and root `AGENTS.md` files below 200 lines and 16 KiB. Keep nested
project files below 120 lines and 8 KiB. Skill entrypoints should route, not
serve as handbooks; use references or durable documentation for conditional
detail.

## Chezmoi

The live home directory is authoritative for ordinary dotfile reconciliation,
but a repository task may intentionally edit this source first. Preview the
exact target with `chezmoi --source <source> diff <path>`, apply only those
paths, and verify the targeted diff is clean. Never run a broad apply as a
shortcut.

The Brewfile is generated from pinned tool manifests. macOS Spotlight paths are
declared in `.chezmoidata.yaml` and applied by the existing configuration
script. Berkeley Mono is licensed local input and must never enter the repo.
