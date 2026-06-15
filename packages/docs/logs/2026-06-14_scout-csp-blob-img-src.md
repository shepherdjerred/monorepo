# Scout web UI: blob: chart images blocked by CSP

## Status

Complete

## Symptom

User on `https://beta.scout-for-lol.com` saw the browser refuse to render
chart images with:

```
Refused to load blob:https://beta.scout-for-lol.com/<uuid> because it does
not appear in the img-src directive of the Content Security Policy.
```

## Root cause

`packages/scout-for-lol/packages/app/src/components/chart-image.tsx` fetches
chart PNG bytes with `fetch(src, { credentials: "include" })`, wraps them in
`URL.createObjectURL(blob)`, and assigns the resulting `blob:` URL to
`<img src>`.

The CSP served from `beta.scout-for-lol.com` (and `scout-for-lol.com`) is
defined once in `packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts`:

```
img-src 'self' https://cdn.discordapp.com data:
```

`blob:` is its own CSP scheme — not covered by `'self'` or `data:` — so every
chart image is rejected.

## Fix

Add `blob:` to `img-src` in `sites.ts` and document why:

```diff
- "img-src 'self' https://cdn.discordapp.com data:",
+ "img-src 'self' https://cdn.discordapp.com data: blob:",
```

The accompanying header-block comment now points at `chart-image.tsx` so the
next reader sees the reason without grepping.

This applies to both `scout-for-lol.com` and `beta.scout-for-lol.com` (they
share `scoutCsp`).

## Verification

- `bun run typecheck` clean for `packages/homelab`.
- No existing test embeds the full `scoutCsp` string
  (`src/cdk8s/src/misc/s3-static-site.test.ts` uses a short standalone CSP),
  so no snapshot needed updating.
- After deploy, the `ChartImage` calls on the standings/charts views should
  render the PNG instead of being silently dropped; the CSP report no longer
  fires for the blob: scheme.

## Session Log — 2026-06-14

### Done

- `packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts`: added
  `blob:` to `img-src`, updated header-block doc comment.
- Worktree: `.claude/worktrees/scout-csp-blob` / branch
  `fix/scout-csp-blob`.

### Remaining

- Merge + Argo sync to push the new ingress annotations to the homelab so
  the header reaches the browser.

### Caveats

- Only the `scout-for-lol.com` + `beta.scout-for-lol.com` CSP changes; other
  static sites still rely on Caddy defaults.
- `connect-src 'self'` was left alone — `ChartImage` fetches from the same
  origin (`/api/...`), so no extra origin is needed.
