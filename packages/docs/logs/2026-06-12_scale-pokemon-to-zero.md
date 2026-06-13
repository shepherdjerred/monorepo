# Scale Discord Plays Pokemon to 0 replicas

## Status

Complete

## Context

Request: "scale pokemon to 0, mario kart to 1" — done in code (GitOps), not via `kubectl scale`.

- `packages/homelab/src/cdk8s/src/resources/pokemon.ts`: `replicas: 1` → `replicas: 0`
- Mario Kart was already `replicas: 1` in `packages/homelab/src/cdk8s/src/resources/mario-kart.ts` (and 1/1 live), so no change needed there.
- Both ArgoCD apps use `syncPolicy.automated: {}` (no self-heal), so a manual `kubectl scale` would have stuck only until the next chart publish — hence the source change.

## Session Log — 2026-06-12

### Done

- Set pokemon deployment to 0 replicas in `packages/homelab/src/cdk8s/src/resources/pokemon.ts`
- Verified homelab typecheck, eslint, helm-lint, and cdk8s tests pass via pre-commit hooks
- PR: https://github.com/shepherdjerred/monorepo/pull/1125 (branch `feature/scale-pokemon-zero`)

### Remaining

- Merge PR #1125; ArgoCD picks up the new chart version and scales the pokemon pod down

### Caveats

- The pokemon pod stays running until the PR merges and CI publishes the new chart — no live `kubectl scale` was applied (user declined the live scale; wanted it in code)
- The user's main checkout has the same one-line edit uncommitted in `pokemon.ts`; it becomes redundant after merge
