# Concepts

Use when Jerred asks for options, directions, or "a few takes" on a UI, a plan, a
logo, a layout, or an architecture sketch.

## Rules

- Publish exactly the number asked for. With no number, publish 2 or 3. Never 4+.
- The directions must differ in kind: a different layout model, information
  hierarchy, interaction pattern, or architecture bet. A palette swap is one
  concept, not three.
- Label them `A`, `B`, `C` with `--label A,B,C`, in one call to one board, with the
  same `--viewport` so they compare fairly.
- Write a `--note-file` per concept only if the concepts are published one at a
  time; otherwise put one line per concept in the message to Jerred: what it bets
  on and what it gives up.
- Each concept is self-contained and viewable alone: no shared state, no import
  from a sibling concept. Follow the sandbox rules in `publishing.md`.
- Render each concept at its viewport yourself first (PinchTab) and fix visible
  breakage before publishing.

```bash
toolkit artifacts publish a.html b.html c.html \
  --board nav-redesign --label A,B,C --viewport 1440x900
```

## After he chooses

When Jerred picks a direction (a comment, or a message), stop branching. Publish
the next version of the chosen artifact with `--version-of <artifactId>` and
leave the others untouched. Do not revive a dropped concept unless asked. If he
wants to combine ideas, treat it as new work on the chosen artifact.

## Mixed boards

A plan PDF and its concepts can share a board (`--board <slug>`). Publish the PDF
with its own call so its label and note stay separate.
