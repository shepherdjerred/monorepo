---
id: log-2026-07-02-scout-sticky-navbar-banner
type: log
status: complete
board: false
---

# Scout frontend: sticky Navbar so the "What's New" banner is visible

## Problem

The "What's New" promo banner (added in #1354) was **in the DOM and deployed** on
`scout-for-lol.com` but invisible. Root cause was a layout/stacking bug, not data or
deploy:

- `WhatsNewBanner` renders in normal flow at `top:0`, `height:40px` (the hero even
  shifted to `top:40` to make room).
- The `Navbar` header was `position: absolute; inset-x-0; top-0; z-50` with an **opaque
  `bg-white`**. Being absolute + `top-0` + z-50, it anchored to the viewport top
  regardless of the banner and **painted its white background directly over the 40px
  banner**. `document.elementFromPoint(200, 20)` returned the nav, confirming the overlap.

The `absolute` header was the old Tailwind-UI hero hack; since this nav is opaque it
wasn't overlaying anything — it was just fighting document flow.

## Fix (modern approach)

Keep everything in normal flow; use `position: sticky` instead of `absolute`.

| File                             | Change                                                |
| -------------------------------- | ----------------------------------------------------- |
| `components/Navbar.astro:56`     | `absolute inset-x-0 top-0 z-50` → `sticky top-0 z-50` |
| `components/Hero.astro:32`       | drop `pt-14` (was clearing the absolute nav)          |
| `layouts/ContentLayout.astro:15` | drop `pt-14`                                          |
| `pages/docs.astro:23`            | drop `pt-14`                                          |
| `pages/getting-started.astro:25` | drop `pt-14`                                          |
| `pages/support.astro:16`         | drop `pt-14`                                          |
| `pages/commands.astro:16`        | drop `pt-14`                                          |

The `pt-14` (56px) on each page existed solely to clear the absolute nav. With the nav in
flow, that padding would double-gap, so it's removed — the inner `py-24/32/48/56` sections
keep the breathing room. Net result: banner scrolls away, nav sticks to the top, no page
regressions.

## Verification

Ran the Astro dev server locally and captured via PinchTab:

- **Home** — indigo "What's New – June 28, 2026: Updated for League patch 26.13" banner
  visible at top, Navbar below it, Hero below that. No overlap.
- **Home scrolled 400px** — banner scrolls away, Navbar sticks to the viewport top.
- **/docs** (ContentLayout-style) — clean, correct spacing, no excessive top gap.
- **/whatsnew** (Hero-based) — clean, gradient hero starts right under the sticky nav.

Also: `eslint` clean on the 7 files, `prettier --check` clean.
