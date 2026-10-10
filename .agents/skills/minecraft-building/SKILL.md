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
     program ops in the log). See references/dsl-cheatsheet.md, and
     references/craft.md (shape, depth, roofs), references/palettes.md
     (blocks, gradients, proven palettes) and references/landscape.md
     (terrain, water, paths, `craft.tree`) before designing.
     Start from the closest curated program: `library search --tag <t>`,
     then `library use <slug> <dir>`. Before writing helpers, check
     `toolkit mc build component ls` and import shared components
     (`terrain`, `rocks`, `house`, `ramparts`, …) — see
     references/components.md.
   - **Import** an existing design: `toolkit mc build import <dir> <file>
[--at x,y,z]` takes `.litematic` or `.schem`; an OBJ mesh (statues,
     organic shapes, image→3D output) also needs `--height <blocks>` and
     optionally `--solid` and `--palette wool|concrete|terracotta`. Each
     import appends a paste op and renders a preview to check before `run`.
5. **Run, look, critique, keep the best.** DSL builds iterate offline;
   the canvas is for WorldEdit ops and the final run:

   ```bash
   toolkit mc build compile <dir>
   toolkit mc build render <dir> --source compiled --name v1   # contact sheet; open it with Read
   toolkit mc build lint <dir> --source compiled
   toolkit mc build critique <dir>                             # blind 0–5 scores + ranked changes
   toolkit mc build candidate <dir> save --name v1
   ```

   Then, per iteration (at least two, at most five):
   - Look with purpose (references/looking.md): squint for massing, relief
     or elevations for depth, `--mode light --floor <y>` for interiors,
     `--views pov` for the eye-level shot, `--compare v1` to see what a
     change did. Keep at most 12 renders in context; cite earlier ones as
     `[an earlier look: renders/<name>.png]`.
   - Make one focused change for the lowest axis the critique named (or
     try two or three variants on the scratch pad: `toolkit mc build
scratch <dir>`), render, critique, `candidate save --name v2`.
   - `toolkit mc build candidate <dir> knockout` judges the new version
     against the incumbent blind, order-swapped; a tie keeps the
     incumbent. `candidate pick <name>` restores the winner.
   - Write what you saw, not what to do next: `toolkit mc build note <dir>
"<observation>"`. `notes.md` holds longer observations.
   - Stop at 4/5 on every axis or after five iterations. Report the final
     scores and at least one remaining weakness; a clean lint is not a
     good-looking build.

   A theme is a palette, not a design: before promoting, the build must go
   beyond the defaults on **massing** (L-shape, a second storey, a wing or
   tower), **roof** (gable vs hip, cross gable, dormer) and **one detail**
   (chimney, porch, garden, path, flower boxes). When the winner is a DSL
   build, `toolkit mc build run <dir>` on the canvas freezes it for replay
   and promote. `critique`, `judge` and `knockout` default to `gpt-6.1-sol`
   and need `OPENAI_API_KEY`; without it, score by eye from the sheet and
   record it with `critique <dir> --scores "axis=n,…,aesthetic=n" --note
"…"`, which journals the critique the same way.

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

## Maps

For a town, island or landscape (60–500 blocks), read references/maps.md
first: layout plan, one `ctx.noise` heightfield shared by terrain and
buildings, settlements, composition, large-map tiling, the map rubric and
district close-ups with `toolkit mc build render <dir> <x1,y1,z1> <x2,y2,z2>`.
`--views survey` tiles the whole map at readable scale; `critique --rubric
map` and `knockout --rubric map` use the map rubric.

## Rules

- Never hand-place block-by-block when a WorldEdit op or DSL primitive fits.
- Keep every edit inside the captured site box; the canvas resets only that box.
- Prefer persistent leaves (`oak_leaves[persistent=true]`) in decoration.
- Program files are pure: runtime imports only from components and `.ts`
  helpers inside the build dir; no `Math.random`, `Date`, `process` or
  `fetch` (compile rejects them); use `ctx.rng()` / `ctx.noise()`.
- A helper you wrote that others would reuse: `toolkit mc build component
propose <dir> <file> --name n --description d` and report it.
- Console commands at unloaded positions fail; `toolkit mc cmd -- forceload
add <x> <z>` first, or use WorldEdit ops (which load chunks).
- Clean up: `toolkit mc sandbox down <canvas>` when the build is promoted.
- After compaction or a hand-off, `toolkit mc build resume <dir>` prints
  the brief, your notes (observations, not instructions), the journal and
  the live state. It sets no next steps; decide them from the record.
- references/studio-notes.md holds what builders keep re-learning; read it
  once per build, then check each note against the render.

## Evidence

Report the capture, the final render path, lint result, replay result, plan
hash, apply id, and verification status. Attach the contact sheet to the PR or
send it to the user.
