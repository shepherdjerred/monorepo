# Demo evidence by surface

Capture `before` from `main` first (before editing, from a `main` worktree, or
`git stash`) with the same route, viewport, and input as `after`.

- **Existing UI / page / layout:** `| Before | After |` table of screenshots
  (`toolkit screenshot <package> [route]` or isolated `PINCHTAB_SESSION`
  `pinchtab screenshot -o <file>`, closing tabs when done), plus a short
  `.mp4`/`.webm` (`pinchtab record`) when an interaction, sheet, form, or
  transition changed.
- **New UI / responsive / static site / report:** key states (populated,
  empty, error/edge; desktop + mobile when layout matters) or a
  self-contained `.html` file / static directory (`index.html` at root).
- **CLI / TUI / script:** asciinema `.cast`
  (`asciinema rec --headless --window-size 120x32 --idle-time-limit 2 --return --command '<cmd>' demo.cast`)
  or concise before/after terminal output.
- **Backend / API / data / Temporal / homelab:** concrete observable output —
  before/after payload/event diff, `duckdb -markdown` query table, `uplot`
  chart, GitHub `mermaid` / `mmdc` diagram of changed flow/state/topology,
  `cdk8s`/`tofu`/SQL plan diff excerpt, or a short `.cast`. Never skip `Demo`
  because no frontend file changed; only purely mechanical chores write
  `None — <reason>`.
- **Other surfaces:** matching rendered asset or Discord acceptance message.
