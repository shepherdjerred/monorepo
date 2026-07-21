---
id: log-2026-06-19-better-skill-capped-bugsink-triage
type: log
status: complete
board: false
---

# Better Skill Capped — Bugsink Triage

## Context

User asked to "check in on bugsink issues for better skill capped." Bugsink project
ID is **3** (`better-skill-capped`), instance `https://bugsink.sjer.red`, creds in 1Password
item "Bugsink" (Personal) → `credential` field.

## Open issues (4)

| Pri | Issue                                                                          | Events | Window          | Source                                        | Real users?                    |
| --- | ------------------------------------------------------------------------------ | ------ | --------------- | --------------------------------------------- | ------------------------------ |
| P1  | `AxiosError: Request failed with status code 404` on `GET /data/manifest.json` | 40     | Apr 5 → Jun 16  | `src/manifest-loader.ts:10`                   | **Yes** — iOS Safari           |
| P2  | `AxiosError: Network Error` on `GET /data/manifest.json` (status 0)            | 7      | Mar 12 → Jun 16 | `src/manifest-loader.ts:10`                   | **Yes** — iOS Safari           |
| P3  | `[(...s),(...c),(...l)].toSorted is not a function`                            | 4      | Jun 12 → Jun 19 | `src/components/app.tsx:64/68/72`             | No — only `HeadlessChrome/105` |
| P3  | `[(...t.courses)].toSorted is not a function`                                  | 1      | Jun 19          | `src/components/app.tsx:64` / `router.tsx:49` | No — only `HeadlessChrome/105` |

## Findings

### `/data/manifest.json` (P1/P2 — same endpoint)

- `ManifestLoader.load()` (`src/manifest-loader.ts:10`) does `axios.get("/data/manifest.json")`
  to fetch the core content manifest, then `ManifestSchema.parse(...)`.
- P1 = the file 404s for some users; P2 = the same request network-aborts (status 0).
  Both real iOS Safari (`Version/26.5 Mobile`). Ongoing for months.
- Likely a deploy/CDN/static-hosting gap: `/data/manifest.json` not consistently served,
  or intermittently unreachable. Needs verification against the live hosting (where does
  `/data/manifest.json` get published?).

### `toSorted` (P3 ×2 — latent compat bug + recurring regression)

- `Array.prototype.toSorted` requires Chrome 110+ / Safari 16+ / Firefox 115+. Vite/esbuild
  does **syntax** transforms only — it does **not** polyfill missing runtime APIs, so
  `.toSorted()` ships verbatim and throws on older engines.
- Every event came from `HeadlessChrome/105.0.5173.0` (a bot / synthetic monitor), so real
  modern-browser impact is ~nil today — but it's a real latent bug for any old browser.
- **Regression:** identical signatures were marked RESOLVED in March (resolved issues
  `f5ed82b3`, `81412d02`, `3b7592e4` — minified names `o.courses` / `d,m,p`). They came back
  with new minified names (`t.courses` / `s,c,l`) after a rebuild, so Bugsink regrouped them
  as new issues. Resolving never fixed the source; the `.toSorted` calls are still in the code.
- Usages: `src/components/app.tsx:64,68,72`, `src/components/router.tsx:49`. In `app.tsx`
  each call already spreads into a fresh array (`[...content.courses].toSorted(...)`), so the
  drop-in fix is `.sort(...)` (mutates the copy, equivalent result). Or set Vite `build.target`
  / add a polyfill.

### Cross-cutting

- No release tagging: every event has `release: null`. Wiring Sentry `release` would make
  "which deploy regressed" answerable and stop the resolve→regroup churn from hiding repeats.

## Session Log — 2026-06-19

### Done

- Triaged all 4 open + 6 resolved Better Skill Capped Bugsink issues (project 3).
- Root-caused each open issue to specific source lines; identified the `toSorted`
  resolve→regroup regression and confirmed the offending UA is `HeadlessChrome/105`.

### Remaining

- P1/P2: verify where `/data/manifest.json` is published and why it 404s / aborts for
  iOS Safari; fix hosting or add a graceful fallback in `ManifestLoader.load()`.
- P3: replace the 4 `.toSorted(...)` calls with `[...].sort(...)` (or lower Vite build
  target / add polyfill); then resolve both open `toSorted` issues in Bugsink.
- Optional: wire Sentry `release` so regressions are attributable to a deploy.

### Caveats

- No code was changed. Bugsink REST API is read-only for issue state — resolving/muting
  must be done via the authenticated web UI (see `reference_bugsink_resolve_via_ui` memory).
