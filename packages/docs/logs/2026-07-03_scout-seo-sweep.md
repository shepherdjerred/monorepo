# Scout for LoL — SEO + Mobile/Desktop Usability Sweep

## Status

Complete (audit only — no code changes)

Audited the live marketing site **https://scout-for-lol.com/** and cross-referenced
every finding against source in `packages/scout-for-lol/packages/frontend/`.

## SEO findings (prioritized)

Root cause: `src/layouts/Layout.astro` hardcodes a single `<title>`, takes no props,
and emits no description/canonical/OG/Twitter/JSON-LD. `astro.config.mjs` has no `site`.
All 6 indexable pages therefore ship identical `<head>` metadata.

| #   | Sev | Issue                                                                                                | Evidence                     | Fix location                       |
| --- | --- | ---------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------- |
| 1   | P0  | Every page has identical `<title>` "Scout for League of Legends"                                     | 6/6 pages live               | `Layout.astro:13` add `title` prop |
| 2   | P0  | No meta description anywhere                                                                         | no `<meta name=description>` | `Layout.astro`                     |
| 3   | P0  | Favicon broken — `/favicon.svg` referenced but 404 (absent from `public/`)                           | curl 404                     | `Layout.astro:11` + add asset      |
| 4   | P0  | No `sitemap.xml` (404)                                                                               | curl 404                     | add `@astrojs/sitemap`             |
| 5   | P0  | No canonical + `/commands` and `/commands/` both 200 → dup content                                   | both 200                     | `Layout.astro`                     |
| 6   | P1  | No Open Graph / Twitter Card (bad share previews on Discord/Reddit/Pinterest — the paid ad channels) | none                         | `Layout.astro`                     |
| 7   | P1  | `site` unset in `astro.config.mjs` — blocks absolute URLs/sitemap/canonical/OG                       | config                       | `astro.config.mjs:14`              |
| 8   | P1  | robots.txt has zero directives + no `Sitemap:` line (only content-signal comments)                   | curl                         | `public/robots.txt`                |
| 9   | P1  | No JSON-LD structured data (SoftwareApplication/Organization)                                        | none                         | `Layout.astro`                     |
| 10  | P2  | viewport missing `initial-scale=1`                                                                   | `Layout.astro:10`            | one-line                           |
| 11  | P2  | `/dev/*` pages indexable (should be noindex)                                                         | pages exist                  | per-page prop                      |
| 12  | P2  | `review-tool.astro:6` passes `title=` prop Layout ignores (dead code)                                | grep                         | fixed by #1                        |
| 13  | P2  | Soft-404: missing paths `301→403` instead of `404`                                                   | `/does-not-exist` → 403      | hosting/redirect                   |
| 14  | P3  | `www.scout-for-lol.com` does not resolve (DNS NXDOMAIN)                                              | dig                          | DNS (optional)                     |
| 15  | P3  | No apple-touch-icon / PNG favicon fallback                                                           | head                         | `Layout.astro`                     |

**Already good:** HTTPS enforced (http 301→https) + HSTS · Brotli compression · exactly one
`<h1>`/page with logical h2/h3 · all 10 homepage images have `alt` · `lang="en"` · Plausible.

## Mobile / Desktop usability findings

Tested via CDP device emulation (Chrome 150) at 375×812 (mobile), 768×1024 (tablet),
1440×900 (desktop) across `/`, `/commands`, `/getting-started`.

**Strong points (reliable):**

- **No horizontal overflow at any width** (scrollWidth == clientWidth at 375/768/1440). The
  one over-wide node is the decorative gradient blob, clipped by an ancestor — not a real overflow.
- **No tiny fonts** (<12px) anywhere.
- Layout renders cleanly at all three widths; desktop shows full nav, mobile collapses to a hamburger.
- Pinch-zoom is NOT disabled (no `maximum-scale`/`user-scalable=no`) — accessibility win.

**Tap-target sizing (real, minor):** several interactive elements are below the recommended
minimum (Apple 44×44px / Google 48px), height being the limiting dimension:

- Inline text links (`View all →`, `slash command reference →`, etc.): ~20px tall
- Footer links (Privacy Policy, Terms, Get Support, GitHub): 24px, and only **17px** on `/getting-started`
- Nav links 40px, CTA buttons (`Get Started`, `Read the docs →`) 36–40px — just under 44
- Fix: bump vertical padding on footer/inline link clusters; raise CTA/nav to ≥44px min-height.

**viewport:** `width=device-width` without `initial-scale=1` (SEO item #10) — also a mobile
best practice; modern browsers default to 1 but adding it avoids iOS orientation-zoom quirks.

**Mobile menu — CONFIRMED WORKING.**
The hamburger is a Radix `Sheet` drawer (`ClientMobileNav`, `client:load` island). Verified in a
**low-stealth headed Chrome** instance at 375px: all `_astro` chunks loaded, the island hydrated
(`hasReactFiber: true`, `ssr` attr removed), and a real tap opened the drawer with all nav links
(Home/Getting Started/Documentation/Commands/What's New/Support/GitHub + Get Started CTA + close
button + scrim). In-drawer tap targets are large and well-spaced (>44px).

Diagnostic note: an initial test in a **full-stealth** headless instance falsely showed
non-hydration — that instance injects its own CSP that blocked script loading (Plausible
`blocked: csp`, 3 of 4 same-origin `_astro` chunks never fetched) **even though the site ships no
CSP** (no header, no meta; all chunks 200 via curl). Lesson: use a low/no-stealth instance for any
JS-interaction testing on this site.

## Recommended fix (SEO)

~90% of SEO items collapse into one change: give `Layout.astro` typed props
(`title`, `description`, `image?`, `noindex?`) rendering title/description/canonical/OG/Twitter/JSON-LD;
set `site: "https://scout-for-lol.com"`; add `@astrojs/sitemap`; add a real favicon; rewrite
`robots.txt` with a `Sitemap:` line. Then pass per-page `title`/`description` from the 6 pages.
Open as one PR with a before/after social-share preview attached. Open question for the user:
which image to use as the default OG/share image (recommend a generated match-report showcase).

## Session Log — 2026-07-03

### Done

- Full SEO audit of live site + source (15 findings, table above)
- Mobile/desktop usability audit via CDP emulation at 3 widths (overflow, tap targets, fonts, viewport)
- Determined mobile-menu non-hydration was a stealth-browser CSP artifact, not a site bug
  (site ships no CSP; all `_astro` chunks 200)

### Remaining

- Implement the SEO fix PR (not started — awaiting go-ahead + choice of default OG image)
- Optional: raise sub-44px tap targets (footer/inline links, CTA min-height)

### Caveats

- Mobile menu is confirmed working; the initial "broken" reading was a full-stealth-browser CSP
  artifact. Any future JS-interaction testing on this site must use a low/no-stealth instance.
- Soft-404 (301→403) and www-non-resolution are hosting/DNS-layer, not in the Astro source.
