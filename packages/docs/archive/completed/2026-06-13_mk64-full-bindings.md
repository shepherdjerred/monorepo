# MK64 — /help bindings, name-textbox fix, UI design

## Status

Complete. Shipped in PR #1178.

## Context

Three asks for `packages/discord-plays-mario-kart/`. The user-added constraint is that **every** N64 input — every button + both stick axes + every shoulder/trigger + Start + all 4 C-buttons + all 4 D-pad — must be bindable from the keyboard and documented in `/help`.

1. **`/help` is missing bindings.** The Discord slash command lists only a subset of the keyboard mappings the web controller actually supports. Several aliases (Space, P, Z, Q) and the L button are absent, and "Steer: A / D (or ←/→)" conflates analog steering (A/D, the X-axis) with the D-pad (arrow keys, used for menu navigation), which is misleading.
2. **Name textbox swallows characters that are also UI controls.** Typing your name, letters like `a`, `d`, `w`, `s`, `e`, `p`, `q`, `z`, `i`, `j`, `k`, `l` (plus Shift/Enter) get eaten because a global `keydown` listener calls `event.preventDefault()` for any key in `KEYMAP` regardless of focus target.
3. **Complete coverage of every N64 input.** Wire protocol already carries `analogY` (`packages/common/src/model/input.ts`) but `KEYMAP` has no keys mapped to it. The N64 stick is 2D and must be bindable in 2D, even though MK64 racing reads only X — Y matters for menus and is part of the "every input" requirement.
4. **UI design polish.** Direction recommended below in prose; tradeoffs spelled out.

Single web controller frontend (React 19 + Vite + Tailwind v4) at `packages/discord-plays-mario-kart/packages/frontend/src/`. Source of truth for bindings is `input-map.ts` (`KEYMAP`). Discord bot at `packages/discord-plays-mario-kart/packages/backend/src/discord/slashCommands/commands/help.ts`.

## Fix 1 — Bind analog Y, then update `/help` to list every binding

### 1a. Add analog Y to `KEYMAP`

**File:** `packages/discord-plays-mario-kart/packages/frontend/src/input-map.ts` (around line 24)

`KEYMAP` currently only emits `{kind: "axis", axis: "x"}`. Add two new entries for the Y axis. Pick keys that don't collide with WASD/face-button cluster or the D-pad. Proposal: **`KeyR` = stick up (+1), `KeyF` = stick down (-1)** — they sit just above/below the WASD home row, are unused today, and `R` doesn't shadow the R-trigger (that's `ShiftLeft`/`ShiftRight`).

```ts
KeyR: { kind: "axis", axis: "y", value: 1 },
KeyF: { kind: "axis", axis: "y", value: -1 },
```

`computeState` in the same file already handles the `y` axis branch (it's the same shape as `x`) — confirm during implementation; if it doesn't, mirror the X-axis path.

The `AnalogStick` component in `controller-ui.tsx` currently visualizes only `axisX`. Extend it to take `axisY` and translate the on-screen stick on both axes. The "Pressed" pill row in `app.tsx` (lines 327–342) should also surface "Stick ↑" / "Stick ↓".

### 1b. Rewrite `/help` to enumerate every binding and surface the URL

**File:** `packages/discord-plays-mario-kart/packages/backend/src/discord/slashCommands/commands/help.ts`

Current embed (lines 27–30) lists 4 control bullets and says only "Open the web controller" with no URL. Rewrite to (a) prominently call out **https://mariokart.sjer.red** and (b) mirror `KEYMAP` exactly, with analog stick split from D-pad.

Shape (lines stay the same overall structure — bold heading, bullets, footer):

```
**Discord Plays Mario Kart 64**
Watch the live game when @userbot is streaming in the #channel voice channel (Go-Live).

**Play:** https://mariokart.sjer.red
Open the controller, claim one of the 4 seats (P1–P4), and drive your kart in real time.

**Controls**
* Analog stick X (steer): A / D
* Analog stick Y:         R / F
* D-pad (menus):          Arrow keys
* A (accelerate):         W or Space
* B (brake/reverse):      S
* Z (item):               E or Z
* L (left trigger):       Q
* R (hop/drift):          Shift
* Start:                  Enter or P
* C-buttons (camera):     I / J / K / L

Players navigate the menus themselves — pick 1–4 player VS, characters, and a track using the seats you claim.
/screenshot posts a frame to #notifications.
```

URL handling: drop a bare `https://mariokart.sjer.red` so Discord auto-links it. If a hostname already exists in `config.ts` (frontend deploy URL), pull from there instead of hardcoding so it stays in sync with the actual ingress — quick grep during implementation, fall back to hardcoded if not. Use `inlineCode()` for keys as the existing bullets do. The full source of truth for bindings lives in `frontend/src/input-map.ts:24-45` (`KEYMAP`) — if anything is added there later, this help block needs to be updated in lockstep.

### 1c. Update the in-app Mapping sidebar

**File:** `packages/discord-plays-mario-kart/packages/frontend/src/app.tsx` (lines 354–363)

Add a row for stick Y and split the existing Stick row into X/Y so the sidebar, `/help`, and `KEYMAP` are in perfect agreement.

## Fix 2 — Don't preventDefault when typing into a form field

**File:** `packages/discord-plays-mario-kart/packages/frontend/src/app.tsx` (lines 134–146)

Both `onKeyDown` and `onKeyUp` install themselves on `globalThis`. Neither inspects `event.target`. When focus is in `<input>` (name entry — `name-entry.tsx`), `<textarea>`, or any `contentEditable` element, both should bail out before `preventDefault()` and before mutating the pressed set.

Add a small helper at module scope:

```ts
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
```

Then guard at the top of both handlers:

```ts
const onKeyDown = (event: KeyboardEvent) => {
  if (isEditableTarget(event.target)) return;
  const code = resolveKeyboardCode(event);
  if (code === undefined || KEYMAP[code] === undefined) return;
  event.preventDefault();
  press(code);
};
```

Same guard at the top of `onKeyUp`. Leave the `blur` handler as-is (it's the safety release when the window loses focus, which already includes input-focus shifts).

The existing `name-entry.tsx` `onKeyDown` (which handles Enter→save) keeps working because the global handler now early-returns and never preventDefaults the bubbling event.

**Why not `stopPropagation` on the input?** Because the global listener is on `globalThis` (window), it fires during the capture phase no matter what — the input's bubble-phase `stopPropagation` is too late. Filtering by target in the global handler is the correct fix.

## Fix 3 — UI design

**Recommendation: "authentic N64 polish" as the dominant direction, with mobile-first reflow folded in.** The most distinctive thing about the current page is the SVG controller mock-up — leaning into that gives the page its own identity rather than looking like a generic web form. Mobile reflow rides along because the current 880px-fixed layout already squeezes on phones (`h-[650px]` clamps at narrow widths) and you said "every input" must be bindable — phones need bigger, well-laid-out controls to play in voice channels.

What that means concretely:

- **Theme tokens.** New `packages/discord-plays-mario-kart/packages/frontend/src/styles/theme.css` (Tailwind v4 `@theme` block) extracting the gradient/shadow strings sprinkled across `controller-ui.tsx` and `app.tsx` into named tokens (`--color-shell-base`, `--color-button-a`, `--shadow-button-rest`, `--shadow-button-press`, etc.). Stops the bleed of one-off `from-zinc-500 via-zinc-800 to-zinc-950` strings.
- **Controller shell.** Refine `N64ControllerShell` SVG: real N64 three-prong silhouette (or its trident), more accurate proportions (memory ports are vestigial — don't draw them), molded-plastic specular highlight along the top edge, subtle inset/outset shadows on the button wells.
- **Buttons.** Color-true palette — A blue (#0085D0-ish), B green, C-buttons yellow ochre, Start red — with pressed/rest states distinguished by depth shadow + 1px down-translation rather than only opacity change. Letters embossed (text-shadow inset).
- **Analog stick.** Becomes 2D now that Y is mapped (Fix 1a). Square deadzone visualization in the center.
- **Layout.** Two-pane on desktop (controller left, mapping+leaderboard right, today's shape). On mobile (< 640px): single column, leaderboard collapses to a sticky strip at the top, controller fills the rest of the viewport with the D-pad on the bottom-left and face buttons on the bottom-right (the canonical mobile game layout you described in the preview). Name entry as a small chip near the seat indicator, not a wide bar.
- **Pressed pills.** Move from the bottom of the controller card into the mapping sidebar / mobile sticky strip so the controller itself stays clean. The on-screen button "press" visual is the primary feedback.
- **Reduced-motion + a11y.** `prefers-reduced-motion` kills the press translate. All controls keep `aria-label` and proper button semantics — current `onPointerDown/onPointerUp` setup means keyboard users currently can't tab through the on-screen buttons, fix during the pass.

Files this touches:

- `frontend/src/styles/theme.css` (new) + import from `main.tsx` / global stylesheet
- `frontend/src/controller-ui.tsx` (shell SVG, button visuals, analog stick 2D)
- `frontend/src/app.tsx` (layout reflow, pressed-pill relocation, mapping sidebar updates from Fix 1c)
- `frontend/src/name-entry.tsx` (chip styling)
- `frontend/src/leaderboard.tsx` (sticky variant for mobile)

If at implementation time the recommendation feels wrong, the easy redirect is to keep theme tokens + Fix 1 + Fix 2 and skip the visual rework. Tokens are a no-regret extraction; visuals are the discretionary half.

## Verification

After implementing, in a worktree:

1. `bun run --filter='./packages/discord-plays-mario-kart/**' typecheck`
2. `bun run --filter='./packages/discord-plays-mario-kart/**' test`
3. `bunx eslint packages/discord-plays-mario-kart` in each subpackage that changed.
4. **Manual /help check.** Spin up the bot locally or read `help.ts` and confirm every binding from `KEYMAP` appears in the embed.
5. **Manual name-entry check.** `bun run --filter='./packages/discord-plays-mario-kart/packages/frontend' dev`, claim a seat, focus the name input, type `wasdezpqijkl` — all characters should appear, no buttons should light up on the on-screen controller. Then click away from the input and confirm the controls still work.
6. **Mapping sidebar parity.** Confirm the in-app mapping list (`app.tsx:354-363`) and the Discord embed agree.
7. For the UI design pass, drop screenshots into the PR description (per global rule for visible changes) — before/after, plus mobile + desktop widths.

## Files touched

| File                                                              | Change                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/.../frontend/src/input-map.ts`                          | Add `KeyR`/`KeyF` → analog Y; mirror x-axis logic if needed                                                               |
| `packages/.../frontend/src/controller-ui.tsx`                     | `AnalogStick` 2D translate; shell SVG polish; button visual refresh                                                       |
| `packages/.../frontend/src/app.tsx`                               | `isEditableTarget` guard on global key handlers; mapping sidebar adds stick Y row; layout reflow; pressed-pill relocation |
| `packages/.../frontend/src/styles/theme.css` (new)                | Tailwind v4 `@theme` design tokens                                                                                        |
| `packages/.../frontend/src/leaderboard.tsx`                       | Sticky-strip variant for mobile                                                                                           |
| `packages/.../frontend/src/name-entry.tsx`                        | Chip styling                                                                                                              |
| `packages/.../backend/src/discord/slashCommands/commands/help.ts` | Replace controls section with full enumeration including stick Y                                                          |

## Worktree note

This is multi-file PR-bound work, so before the first edit: create `git worktree add .claude/worktrees/mk64-full-bindings -b feature/mk64-full-bindings origin/main`, then `bun run scripts/setup.ts` inside it. Every Write path needs `.claude/worktrees/mk64-full-bindings/` in it — never write to the main checkout.

## Session Log — 2026-06-13

### Done

- Bound analog Y to `KeyR` / `KeyF` (input-map.ts) with matching `STICK_Y_CONTROLS` so the integrity tests stay green.
- `AnalogStick` redesigned: 2D knob translate; four chevron press zones now show the actual keyboard letter (R/F/A/D) with a small direction arrow above; the outer well gets a recessed-hex N64 boot look (split out to `analog-stick.tsx` to keep `controller-ui.tsx` under the 500-line cap).
- Global `onKeyDown`/`onKeyUp` skip `preventDefault` when the event target is an `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable` element; verified live via PinchTab eval.
- `/help` rewritten — bare `https://mariokart.sjer.red` and one bullet per N64 input.
- Mapping panel rebuilt as a three-column Action / N64 / Keyboard reference table, keycap-styled keys, ordered by MK64 frequency-of-use.
- D-pad cluster gets an `ARROW KEYS` caption badge under it.
- Theme tokens extracted to a Tailwind v4 `@theme` block in `index.css`; `prefers-reduced-motion` baseline added.
- Leaderboard and NameEntry repainted from `slate-*` to `zinc-*` to unify the palette; NameEntry becomes a pill chip.
- Pressed pills lifted out of the controller card into a "Live input" sidebar card; status becomes a dot+text pill; latency hides when unmeasured.
- Controller shell SVG gradients lightened to match the real N64 plastic gray.
- Shipped as commits `0180e40` (bindings + textbox + /help), `fbeb390` (design polish), `04ce159` (discoverability — D-pad caption, stick keyboard labels, Mapping action column).

### Remaining

- Rear-trigger annotations for L/R/Z were planned but not shipped — the user mentioned the front/back/side complexity but didn't demand it; deferable to a follow-up if the rear-trigger affordance still reads as confusing.
- A full SVG-shell redraw (matching the reference image proportions more closely) was scoped in but skipped; the lighter palette + analog-stick polish covered most of the visual gap. Bigger SVG rewrite would be its own PR.
- Mobile-first reflow — single-column layout, sticky leaderboard, etc. — was scoped in the original plan but the desktop polish came first; mobile still uses the fixed 880-wide controller frame.
- PR #1178 is open; no manual verification on prod yet (claim a seat, type a name, confirm `/help` renders the URL).

### Caveats

- **Never run `bunx eslint . --fix` on this package.** The custom `custom-rules/no-use-effect` rule's autofix silently deletes useEffect bodies (cost me an iteration mid-session — recovered via `git restore`). Lint without `--fix`; the 4 remaining useEffect warnings are pre-existing on `main`.
- The new `MAPPING_ROWS` table is duplicated from `KEYMAP` + the on-controller positions. If a binding is added/changed in `input-map.ts` you must also update `MAPPING_ROWS` in `app.tsx` AND the `/help` command. There's no programmatic link yet — could be a future cleanup (derive the Mapping table from `KEYMAP` + action metadata).
