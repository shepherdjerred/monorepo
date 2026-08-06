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
