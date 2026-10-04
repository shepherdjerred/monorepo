---
name: minecraft-building
description: Design and place good-looking Minecraft builds with `toolkit mc build` — capture a site, author on a sandbox canvas with WorldEdit and the mc-build DSL, render contact sheets and lint, replay, then promote with a plan hash and undo. Use when asked to build, decorate, or landscape an area, or to prototype architecture in Minecraft.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# Minecraft building

Builds are a **replayable op log** (WorldEdit commands, schematic pastes,
console commands) developed on a throwaway **canvas** seeded with a captured
copy of the real site, then **promoted** to the target as one exact snapshot
paste with an undo snapshot and journal. Everything runs through the mc-harness
daemon; load the `minecraft-harness` skill for daemon and sandbox basics.

Targets are sandboxes only for now. Never promote without showing the user the
render and getting a go-ahead when the target is a server people play on.

## The loop

1. **Brief.** Pin down style, footprint, height, and the exact area (world +
   two corners). Ask if the area is unknown — never guess coordinates.
2. **Init and capture** the site (include ground under the build and some
   margin around it):

   ```bash
   toolkit mc build init ./builds/cottage --name cottage --world world --anchor 26,-60,26
   toolkit mc build capture ./builds/cottage --target <id> --world world 20,-61,20 40,-45,40
   ```

   Read `renders/site.png` before designing; note slope, water, trees.

3. **Canvas:** `toolkit mc build canvas ./builds/cottage` — a void sandbox with
   the site pasted at the same coordinates; it becomes the default target.
4. **Author** with either or both:
   - **WorldEdit**, recorded: `toolkit mc we --target <canvas> --record <dir>
--world world --pos1 x,y,z --pos2 x,y,z "//set …"`. Always give explicit
     coordinates (`--pos1/--pos2` or `--at`); negative values need no
     quoting. See references/worldedit-cookbook.md.
   - **Program** (`build.ts`, precise architecture): edit it, then
     `toolkit mc build compile <dir>` (compiles, lints, and replaces the earlier
     program ops in the log). See references/dsl-cheatsheet.md.
     Start from the closest curated program: `library search --tag <t>`,
     then `library use <slug> <dir>`.
5. **Run, look, critique:**

   ```bash
   toolkit mc build run <dir>        # reset canvas to site, replay all ops, freeze result
   toolkit mc build render <dir>     # contact sheet PNG — open it with Read
   toolkit mc build lint <dir>
   ```

   Fix every lint error, then critique with references/rubric.md:
   - Do **at least two** render → critique → revise iterations (≤5 total).
     Each one scores all eight aspects 0–2, names the lowest, and makes one
     concrete change for it; re-render and look again.
   - A theme is a palette, not a design. Before promoting, the build must go
     beyond the defaults on **massing** (L-shape from two footprints, a
     second story, a wing or tower), **roof** (gable vs hip, cross gable,
     dormer) and **one detail** (chimney, porch, garden, path, flower boxes).
   - Optional second opinion: `toolkit mc build judge <render> <render>`
     runs an order-swapped vision judge (needs a vision model credential).
   - Report the final scores and at least one remaining weakness. A clean
     lint is not a good-looking build; say what you actually see.

6. **Replay:** `toolkit mc build replay <dir>` replays the log on a fresh
   seeded sandbox. A mismatch means non-deterministic ops (random `%`
   patterns); promote is still exact because it applies the frozen result.
   Verify and replay ignore state the server recomputes from neighbors (pane,
   fence and wall connections, stair shape, leaf distance), so panes are fine.
7. **Show the user** the final render (and lint summary) before promoting.
8. **Promote:** dry run prints a `planHash` and how many blocks change; then
   confirm:

   ```bash
   toolkit mc build promote <dir> --target <id>
   toolkit mc build promote <dir> --target <id> --confirm <planHash>
   ```

   It refuses if the target drifted from the captured site (re-capture and
   rebuild). The result is verified cell by cell and journaled.

9. **Undo** if needed: `toolkit mc build undo <applyId>` (last in, first out;
   restores block entities such as chest contents). `toolkit mc build status
   <dir>` lists applies.

## Rules

- Never hand-place block-by-block when a WorldEdit op or DSL primitive fits.
- Keep every edit inside the captured site box; the canvas resets only that box.
- Prefer persistent leaves (`oak_leaves[persistent=true]`) in decoration.
- Program files are pure: `import type` only, no `Math.random`, `Date`,
  `process` or `fetch` (compile rejects them); use `ctx.rng()`.
- Console commands at unloaded positions fail; `toolkit mc cmd -- forceload
add <x> <z>` first, or use WorldEdit ops (which load chunks).
- Clean up: `toolkit mc sandbox down <canvas>` when the build is promoted.

## Evidence

Report the capture, the final render path, lint result, replay result, plan
hash, apply id, and verification status. Attach the contact sheet to the PR or
send it to the user.
