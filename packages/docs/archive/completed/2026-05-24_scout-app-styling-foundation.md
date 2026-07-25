---
id: reference-completed-2026-05-24-scout-app-styling-foundation
type: reference
status: complete
board: false
---

# Scout App Styling Foundation

## Summary

Replace the inline-`style={{}}` scaffold in `packages/scout-for-lol/packages/app/` with a real styling foundation: Tailwind v4 + neutral shadcn-style primitives + class-based light/dark mode. **Plain/unstyled** neutral defaults (system fonts, neutral grays) — a visual design language gets layered on later. The app's design is intentionally **separate** from the marketing site (`packages/frontend/`): shared deps (Tailwind, Radix, lucide) are fine, shared visual tokens never. See [[project-scout-web-ui-distinct-design]] and [[feedback-tailwind-v4-pitfalls]].

## Decisions

| Axis       | Pick                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| Framework  | Vite + React 19 SPA (keep) — not Astro, not TanStack Start                                                                  |
| CSS engine | Tailwind v4 via `@tailwindcss/vite` plugin (Vite-native, no PostCSS)                                                        |
| Dark mode  | Class-based with `@custom-variant dark (&:where(.dark, .dark *));` + `useTheme` hook (system / light / dark + localStorage) |
| Primitives | Radix UI à la carte: Dialog, Select, Slot, Label                                                                            |
| Components | shadcn copy-ins under `app/src/components/ui/` — own tokens, no cross-import from `frontend/`                               |
| Tokens     | Neutral shadcn defaults in `app/src/styles/global.css` `:root` + `.dark`. No marketing palette.                             |
| Icons      | `lucide-react`                                                                                                              |
| Forms      | `react-hook-form` + Zod (Zod already transitive via `@scout-for-lol/data`)                                                  |
| Tables     | `@tanstack/react-table` (light usage for now; just primitives table component)                                              |
| Routing    | Stay on `react-router-dom@7` — TanStack Router is a separate follow-up                                                      |

## Anti-traps applied (vs marketing site regressions)

| Marketing-site bug                                     | Mitigation here                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Dead shadcn tokens from incomplete v3→v4 (no `@theme`) | Use `@theme inline` block with CSS-var references; no `tailwind.config.cjs` shipped |
| JS dark toggle inert (no `@custom-variant dark`)       | Declare `@custom-variant dark (&:where(.dark, .dark *));` in `global.css` line 3    |
| `.astro` in ESLint `ignores` let regressions ship      | App is all `.tsx` — no special-casing needed, default lint covers all files         |

## File plan

| File                                             | Action                                                                                  | Approx LOC |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------- |
| `app/package.json`                               | Add deps                                                                                | —          |
| `app/vite.config.ts`                             | Add `@tailwindcss/vite` plugin                                                          | +2         |
| `app/index.html`                                 | Add `<meta name="color-scheme" content="light dark">`                                   | +1         |
| `app/src/main.tsx`                               | Import `./styles/global.css`                                                            | +1         |
| `app/src/styles/global.css`                      | New — Tailwind import, dark variant, `@theme inline`, `:root`/`.dark` tokens, body type | ~90        |
| `app/src/lib/cn.ts`                              | New — clsx + tailwind-merge helper                                                      | 5          |
| `app/src/lib/use-theme.tsx`                      | New — theme hook (system/light/dark + localStorage)                                     | ~60        |
| `app/src/components/ui/theme-toggle.tsx`         | New — sun/moon/system tri-state button                                                  | ~50        |
| `app/src/components/ui/button.tsx`               | New — CVA variants                                                                      | ~55        |
| `app/src/components/ui/card.tsx`                 | New                                                                                     | ~40        |
| `app/src/components/ui/dialog.tsx`               | New — Radix Dialog                                                                      | ~80        |
| `app/src/components/ui/input.tsx`                | New                                                                                     | ~25        |
| `app/src/components/ui/label.tsx`                | New — Radix Label                                                                       | ~15        |
| `app/src/components/ui/select.tsx`               | New — Radix Select                                                                      | ~120       |
| `app/src/components/ui/table.tsx`                | New                                                                                     | ~50        |
| `app/src/app.tsx`                                | Mount `ThemeToggle` somewhere global                                                    | small      |
| `app/src/routes/login.tsx`                       | Replace inline styles with `Button`/`Card`/`Alert`                                      | —          |
| `app/src/routes/guild-picker.tsx`                | Replace inline styles                                                                   | —          |
| `app/src/routes/guild-subscriptions.tsx`         | Replace with `Button`/`Table`/`Dialog`                                                  | —          |
| `app/src/routes/guild-audit.tsx`                 | Replace with `Table`                                                                    | —          |
| `app/src/components/add-subscription-dialog.tsx` | Replace inline modal with `Dialog`/`Select`/`Input`                                     | —          |

## Out of scope (explicit follow-ups)

- Picking the visual design language (fonts, palette, radius). This PR ships neutral defaults so the design choice is a one-file `tokens` edit later.
- Switching from React Router 7 → TanStack Router.
- Searchable channel/region combobox (would need `@radix-ui/react-popover` or Radix Combobox pattern).
- Bulk-import / "paste op.gg" subscription source.
- App shell with persistent header/nav/guild switcher.
- Sharing primitives back into a `packages/scout-for-lol/packages/ui/` package — that experiment burned the marketing site; defer unless a real need emerges.

## Verification

```bash
bun run --filter='./packages/scout-for-lol/packages/app' typecheck
bun run --filter='./packages/scout-for-lol/packages/app' lint
bun run --filter='./packages/scout-for-lol/packages/app' build
```

Plus manual: `bun run --filter='./packages/scout-for-lol/packages/app' dev` and toggle between light/dark/system to confirm `dark:` variants fire (the marketing-site failure mode).

## Session Log — 2026-05-24

### Done

- Plan doc created: `packages/docs/plans/2026-05-24_scout-app-styling-foundation.md`
- Dependencies added to `packages/scout-for-lol/packages/app/package.json`: `tailwindcss@4`, `@tailwindcss/vite`, `@radix-ui/{react-dialog, react-label, react-select, react-slot}`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `react-hook-form`, `@hookform/resolvers`, `@tanstack/react-table`. Installed via `bun install` (lockfile updated, 806 packages resolved).
- `vite.config.ts` now wires `@tailwindcss/vite` plugin alongside the React plugin.
- `index.html` gained `<meta name="color-scheme" content="light dark">`.
- `src/styles/global.css` (new): `@import "tailwindcss"`, `@custom-variant dark (&:where(.dark, .dark *))`, `@theme inline` block referencing CSS vars, `:root` + `.dark` token sets (neutral shadcn defaults), system font body, `color-scheme: light dark` on `<html>`.
- `src/lib/cn.ts` (new): `clsx + tailwind-merge` helper.
- `src/lib/use-theme.tsx` (new): `ThemeProvider` + `useTheme` hook — `system | light | dark` with localStorage persistence + system-pref listener. Mounted in `src/main.tsx` above the tRPC/router providers.
- `src/components/ui/` (new): `button.tsx` (CVA variants), `card.tsx`, `dialog.tsx` (Radix), `input.tsx`, `label.tsx` (Radix), `select.tsx` (Radix), `table.tsx`, `theme-toggle.tsx` (lucide Sun/Monitor/Moon tri-state).
- Routes refactored to use the new primitives: `login.tsx`, `guild-picker.tsx`, `guild-subscriptions.tsx`, `guild-audit.tsx`, and `components/add-subscription-dialog.tsx`. All inline `style={{}}` removed.
- `eslint.config.ts`: added `packages/app/tsconfig.json` to `tsconfigPaths`, and added an override turning `custom-rules/no-shadcn-theme-tokens` **off** for `packages/app/**` — the app defines its own tokens in `global.css`, so they're live CSS, not the dead-token problem that motivated the rule on marketing surfaces.
- Verification: `bun run typecheck` clean (after `bun run --filter='./packages/scout-for-lol/packages/backend' generate` to refresh the Prisma client; the worktree's generated client was stale and missing recently-added models like `auditLog`/`report`/`storedMatch`). `bun run lint` clean. `bun run build` clean (Vite emits `dist/index.html` + `dist/assets/*` under `/app/assets/`). Dev server starts, `curl -sf http://localhost:5180/app/` returns 200 and serves the Vite HTML shell with the right `color-scheme` meta.

### Remaining

- **Visual design language**: the foundation is plain neutral grays + system fonts. A distinct palette/type system for Scout's app surface (separate from marketing) is the next decision — when ready, it's a one-file edit to the `:root` / `.dark` blocks in `app/src/styles/global.css`.
- **Manual browser smoke**: Claude in Chrome was disconnected at session end so light/dark/system toggling was not exercised end-to-end. `bun run --filter='./packages/scout-for-lol/packages/app' dev` to verify.
- **Routing**: still on `react-router-dom@7`. TanStack Router migration is a separate follow-up if/when desired (HN-modal in 2026).
- **Searchable channel/region picker**: native Radix `Select` is fine for ~15 options; a combobox would need `@radix-ui/react-popover` + the WAI Combobox pattern.
- **App shell**: no persistent header/nav/guild-switcher yet. `ThemeToggle` is currently a floating top-right element in `App` — easy to relocate when a real layout lands.
- **Bundle warning**: Vite reported one chunk > 500 kB gz (the main app bundle, 308 kB gz). Code-splitting via route-level dynamic `import()` is a follow-up if/when latency matters.

### Caveats

- The Prisma client was regenerated in this worktree (`bun run --filter='./packages/scout-for-lol/packages/backend' generate`). That's a non-shipped, gitignored artifact — but other agents working on `scout-for-lol` in this worktree benefit from the refresh. If the worktree is recreated, re-run that command before typechecking the app.
- The lint rule scope-change (`packages/app/**` off) was the **right** fix, not a workaround. The marketing-site `no-shadcn-theme-tokens` rule was created to catch _dead_ tokens during the v3→v4 migration. In `app/` the tokens are live (defined in our own `global.css`), so the rule was wrong here. Documented inline in the config rationale.
- All shadcn primitives live in `app/src/components/ui/` — **do not** import any of them from `packages/frontend/`, and vice versa. Each surface owns its own. See `project_scout_web_ui_distinct_design.md` and `feedback_tailwind_v4_pitfalls.md` in `~/.claude/projects/-Users-jerred-git-monorepo/memory/`.
- The dev server requires the Scout backend running on `:3000` for any tRPC call to succeed. Login screen and theme toggle work without backend; everything past `RequireSession` will spin until backend is reachable.
