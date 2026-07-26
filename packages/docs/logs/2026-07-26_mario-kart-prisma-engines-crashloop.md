---
id: mario-kart-prisma-engines-crashloop
type: log
status: complete
board: false
---

# Main build 6333: mario-kart crash-loop blocks argocd health-wait

Seventh leg of the get-main-green session (after
[[turbo-cache-orphan-prune]]). The prune fix worked — the orphaned
`turbo-cache-r2` OnePasswordItem is gone and turbo-cache is Synced/Healthy —
but 6333's `argocd-sync` health-wait timed out on a NEW blocker: the
`mario-kart` app stuck Synced/Progressing because its pod crash-loops:

```
Error: Can't write to /app/node_modules/.bun/@prisma+engines@7.8.0/…/@prisma/engines
please make sure you install "prisma" with the right permissions.
```

## Root cause — #1668 image slimming split the Prisma install

The slimmed `discord-plays-mario-kart` image builds a **production-only
node_modules in a separate `prod-deps` stage** (no lifecycle scripts, no
`prisma generate`), so `@prisma/engines` ships with no engine binaries. The
image CMD runs `bunx prisma db push` at startup; the Prisma CLI tries to
download the missing engines into the package dir — but the pod runs as
uid 1000 (`runAsUser: 1000`) over the root-owned copied tree, so the write
fails and the pod crash-loops. First manifested when the 6322 version
commit-back rolled `2.0.0-6322` (the first slimmed build) to prod.

Why nothing else broke: discord-plays-pokemon's CMD runs no prisma; birmel
deliberately keeps `db push` out of its CMD. The in-image smoke stage runs as
root, so it couldn't catch a uid-1000-only failure.

## Fix

Add to the runtime stage (after the source COPY provides the schema, before
the build-stage artifact COPYs):

```dockerfile
RUN cd packages/discord-plays-mario-kart/packages/backend && bunx --trust prisma generate
```

Engines download at build time as root; startup `db push` finds them in
place and never writes to node_modules.

## Verification (empirical, against the real pushed image)

- Repro: `docker run --platform linux/amd64 -u 1000:1000 <2.0.0-6322 image>
sh -c 'cd packages/backend && bunx prisma db push'` → exact production
  error.
- Fix semantics: same image, `bunx --trust prisma generate` as root, then
  `setpriv --reuid=1000 … bunx prisma db push` → engine error GONE; fails
  only on creating the SQLite parent dir, which in the pod is the writable
  fsGroup-1000 PVC (a bare `docker run` artifact, not a real failure).
- `bun run verify -- --affected` green.

## Session Log — 2026-07-26

### Done

- Diagnosed the mario-kart crash-loop (prod-deps stage ships engine-less
  @prisma/engines + uid-1000 runtime → EACCES on first-use download) and
  baked engines at build time in the Dockerfile (worktree
  `fix/mario-kart-prisma-engines`). Confirmed turbo-cache prune fix (#1677)
  worked in the same build.

### Remaining

- Merge, wait for the images step to push the fixed image and the
  commit-back to roll it out, then argocd health-wait should finally
  converge. Note the rollout is two-build: build N pushes the fixed image +
  bumps the pin via commit-back; the argocd sync that deploys the new pin
  happens in build N+1 (the commit-back merge). Build N's health-wait may
  still time out on the old crash-looping pod.

### Caveats

- The in-image smoke runs as root and misses uid-1000-only failures; a
  follow-up could run the app smoke as the deploy uid.
