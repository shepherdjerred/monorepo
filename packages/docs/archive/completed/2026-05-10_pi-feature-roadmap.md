# Pi Feature Roadmap

## Status

Complete

## Intent

Respond to the user's requested Pi feature set: RST-to-PDF output, ask mode, plan mode, and skills.

## Scope

- Map each requested feature to Pi's existing primitives.
- Identify which items are built in versus extension/package work.
- Keep this response at design/implementation-roadmap level unless the user asks to implement.

## Files to Touch

- `packages/docs/plans/2026-05-10_pi-feature-roadmap.md`
- `packages/docs/index.md`
- `/Users/jerred/.pi/agent/extensions/workflow-modes.ts`
- `/Users/jerred/.pi/agent/settings.json`
- `/Users/jerred/.pi/agent/keybindings.json`
- `packages/dotfiles/dot_pi/agent/extensions/workflow-modes.ts`
- `packages/dotfiles/dot_pi/agent/settings.json`
- `packages/dotfiles/dot_pi/agent/keybindings.json`

## Read-only Bash Design Notes

For ask/plan modes, do not expose built-in `bash`. Expose only a guarded custom command-request tool:

```json
{
  "type": "requested_bash",
  "cmd": "ls",
  "cwd": "",
  "reason": "inspect project files"
}
```

The tool runs a fail-closed read-only policy internally:

- Use a cheap, fast no-tools model as a safety classifier for `{ cmd, cwd, reason }`. As of the installed Pi v0.74.0 model list, OpenAI Codex entries include `openai-codex/gpt-5.5` and cheaper/faster-looking options such as `openai-codex/gpt-5.4-mini` and `openai-codex/gpt-5.3-codex-spark`; make the classifier model configurable and default to the newest acceptable fast tier.
- The classifier must return strict JSON such as `{ "approved": true, "risk": "read_only", "reason": "lists files only" }`.
- Fail closed on classifier errors, timeouts, invalid JSON, or anything other than explicit approval.
- Keep raw built-in `bash` out of the model's active tool menu in ask/plan modes.
- Basic deterministic hard-deny checks are still useful before classifier invocation, especially for obvious mutators, redirects, shell nesting, and arbitrary code execution (`sh -c`, `python -c`, `bun -e`, `eval`, etc.).
- Execute approved commands internally via `pi.exec` or local bash operations, then return the output as the custom tool result.
- Treat post-run dirty checks as a backstop, not the primary guarantee.
- Plan mode may need a narrow exception for writing plan artifacts, and RST rendering may need a narrow exception for writing `.pi/artifacts/*.rst` and `.pdf` outputs.

## Implementation

Implemented a user Pi extension, mirrored into chezmoi dotfiles:

- `/Users/jerred/.pi/agent/extensions/workflow-modes.ts`
- `packages/dotfiles/dot_pi/agent/extensions/workflow-modes.ts`

The extension adds:

- `/ask` command: toggles ask mode, disables raw `bash`/`edit`/`write`, leaves read-only tools plus `requested_bash` and `render_rst_pdf`.
- `/plan` command: toggles plan mode, disables raw `bash`/`edit`/`write`, leaves read-only tools plus `requested_bash`, `plan_write`, and `render_rst_pdf`.
- `/approve-plan` command: returns to normal implementation mode.
- `/mode` command: reports current mode.
- `requested_bash` tool: accepts `{ cmd, cwd, reason }`, hard-denies obvious mutators, invokes a no-tools `pi -p` classifier using `openai-codex/gpt-5.5:minimal` by default, runs approved commands internally, and fails closed.
- `render_rst_pdf` tool: writes RST/PDF artifacts under `.pi/artifacts/`, using `rst2pdf`, `uvx --from rst2pdf rst2pdf`, or `pandoc`.
- `plan_write` tool: writes plan artifacts under `.pi/plans/` only.
- `Shift+Tab` extension shortcut: cycles workflow mode `normal → ask → plan → normal`.
- `Alt+T` extension shortcut and `/think` command: cycles or sets thinking effort.
- Custom Vim editor: starts in INSERT mode, `Esc` enters NORMAL mode, and NORMAL supports `i/a/I/A/o/O`, `h/j/k/l`, `w/b/e`, `0/^/$`, `x/X`, `D/C/S`, `dd`, and `u`.
- `/vim [on|off]` command: explicitly enable or disable the modal Vim input editor in the current session.

Follow-up UX changes requested:

- Reassign `Shift+Tab` to cycle workflow modes, Claude Code style.
- Provide another keybinding for thinking effort.
- Add real modal Vim editor behavior with NORMAL and INSERT modes.

Updated Pi settings, mirrored into chezmoi dotfiles:

- `/Users/jerred/.pi/agent/settings.json`
- `packages/dotfiles/dot_pi/agent/settings.json`
- `/Users/jerred/.pi/agent/keybindings.json`
- `packages/dotfiles/dot_pi/agent/keybindings.json`

Settings now include `~/.claude/skills` and enable skill slash commands. Keybindings now move thinking effort to `Alt+T`; the extension installs the modal Vim editor on `session_start`.

## Verification

- Used the previously inspected Pi documentation plus loaded TypeScript/Bun/Chezmoi skills.
- Mapped each requested feature to Pi primitives: extensions, tools, commands, prompt hooks, settings, and built-in skills discovery.
- Updated `packages/docs/index.md` with this plan entry.
- Added read-only bash design notes for ask/plan mode.
- Revised bash design: ask/plan modes should expose only a guarded custom bash-request tool, not built-in `bash`.
- Added notes on a cheap fast no-tools LLM bash-safety classifier.
- Verified installed Pi model listings include `openai-codex/gpt-5.5`, `openai-codex/gpt-5.4-mini`, and `openai-codex/gpt-5.3-codex-spark` candidates.
- Loaded the extension with Pi's bundled `jiti` to verify syntax and default export.
- Started Pi RPC mode with the extension and confirmed extension commands are registered.
- Invoked `/ask` through Pi RPC mode and observed status/notification events plus a successful response.
- Tested `render_rst_pdf` with a small RST document using `uvx --from rst2pdf rst2pdf`; it produced a PDF successfully, then removed the test artifact.
- Tested `plan_write` path traversal rejection.
- Tested `requested_bash` hard-deny rejection for `rm -rf tmp` without invoking the classifier.
- Tested `requested_bash` end-to-end with `pwd`; the `openai-codex/gpt-5.5:minimal` classifier approved it and the command executed successfully.
- Loaded the updated extension after adding shortcuts, `/think`, and the modal Vim editor.
- Validated live/source `keybindings.json` as JSON.
- Confirmed `/think off` updates thinking level through Pi RPC mode.
- Confirmed Pi RPC starts with the modal-editor extension active and commands registered.
- Fixed INSERT → NORMAL mode switching to use Pi's `matchesKey(data, "escape")` helper instead of relying only on a raw `"\\x1b"` byte comparison, and added `/vim on` as a manual enable path for already-running sessions.

## Session Log — 2026-05-10

### Done

- Created `packages/docs/plans/2026-05-10_pi-feature-roadmap.md`.
- Added it to `packages/docs/index.md`.
- Prepared a feature mapping for RST-to-PDF output, ask mode, plan mode, and skills.
- Added read-only bash policy notes for ask/plan mode.
- Revised bash design: ask/plan modes should expose only a guarded custom bash-request tool, not built-in `bash`.
- Added notes on a cheap fast no-tools LLM bash-safety classifier.
- Verified installed Pi model listings include `openai-codex/gpt-5.5`, `openai-codex/gpt-5.4-mini`, and `openai-codex/gpt-5.3-codex-spark` candidates.
- Implemented `workflow-modes.ts` in live Pi config and mirrored it to chezmoi dotfiles.
- Updated live Pi settings and mirrored them to chezmoi dotfiles so Pi can use `~/.claude/skills` with `/skill:*` commands.
- Added `Shift+Tab` workflow-mode cycling, `Alt+T`/`/think` thinking effort controls, and a custom modal Vim editor with NORMAL/INSERT modes.
- Verified extension loading, command registration, `/ask`, `/think`, RST PDF rendering, plan path traversal blocking, requested-bash hard deny, and requested-bash end-to-end approval/execution.

### Remaining

- Optional follow-up: tune the hard-deny regexes and classifier prompt after real-world use.
- Optional follow-up: decide whether `render_rst_pdf` should auto-open PDFs in ask/plan mode or require explicit `open: true`.
- Optional follow-up: expand modal Vim support with additional operators/search/visual mode if desired.

### Caveats

- Assumed “ask mode” means read-only Q&A/no repo mutation, “plan mode” means plan-first/no repo mutation until approval, and “rst” means reStructuredText.
- Fully proving arbitrary Bash read-only behavior is not realistic; the implemented design avoids exposing raw bash in ask/plan modes, uses deterministic hard-deny checks, runs a no-tools `openai-codex/gpt-5.5:minimal` classifier, fails closed, and checks git dirty state as a backstop.

## Session Log — 2026-05-10 (Vim editor follow-up)

### Done

- Updated `/Users/jerred/.pi/agent/extensions/workflow-modes.ts` and mirrored it to `packages/dotfiles/dot_pi/agent/extensions/workflow-modes.ts`.
- Fixed Vim INSERT → NORMAL switching to recognize Escape through Pi's `matchesKey(data, "escape")` helper as well as raw escape bytes.
- Added `/vim [on|off]` so the modal Vim editor can be explicitly enabled or disabled in an already-running Pi session.
- Re-verified Pi RPC extension loading and command registration, including `/vim` registration.
- Confirmed live Pi files match chezmoi source with `chezmoi diff`.

### Remaining

- Optional follow-up: expand modal Vim support with additional operators/search/visual mode if desired.

### Caveats

- Existing Pi sessions should run `/reload`; if Escape still does not switch modes, run `/vim on` once to force-install the modal editor in that session.
