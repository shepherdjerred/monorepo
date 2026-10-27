# Creative LiveMap and plot-cleanup handoff

PR: https://github.com/shepherdjerred/monorepo/pull/4096

## Scope

- Stop drawing every creative plot name continuously on LiveMap.
- Release recovered claims that have no build or only trivial changes, without deleting substantial historical builds or rewriting terrain.

## Implemented

`BlueMapPlots` now emits only the labelled plot `ShapeMarker`. The separate always-visible `HtmlMarker` and its HTML helper/tests were removed. BlueMap's click detail still shows the plot name, the owner's username, or `staff`. Plot outlines, the Plots toggle, owner fallback behavior, and survival maps are unchanged.

The player and operator documentation reflects the click behavior.

## Verification completed

- `mise exec -- gradle -p packages/the-storm/plugin :creative:test --console=plain`
- `bunx turbo run build typecheck test lint --filter=@shepherdjerred/the-storm` — 21 tasks passed.
- `bun run --cwd packages/the-storm test:smoke` — 7 tests passed.
- `bun run --cwd packages/ts-mc-docs build`, `typecheck`, and `lint` passed.
- Pre-commit passed.
- Sandbox `sbx-cb9c02` with BlueMap 5.29 contained 214 shape markers and zero HTML name markers. A browser click displayed plot detail while no names floated over the map.

Screenshots are attached to the PR.

## Production status

- The PR is ready and exact-head Woodpecker CI is running.
- Artifact publication and ArgoCD deployment have not completed.
- Live currently has zero mutable creative claims, merged claims, ratings, or comments. The visible claims are from the recovered catalog.
- No live claims or terrain have been changed, and no cleanup backup has been taken yet.

## Cleanup procedure

1. Finish the read-only region audit. Compare playable recovered plots against both the original empty plot baseline (`-2;-8`) and the cleared generator. A candidate must differ by at most 512 blocks from either baseline.
2. Review the exact IDs, owners, change counts, and unexpected block types. Reject borderline plots with real builds even if they pass the numeric threshold. Keep the out-of-border plot and substantial builds untouched.
3. Re-read the live claim tables immediately before mutation. Exclude any new player-created, merged, rated, or commented claims.
4. Run `toolkit mc live backup --wait --reason "before creative empty-plot cleanup"`.
5. Use an op actor through `toolkit mc --target live` to run `/creative admin unclaim` on each reviewed plot with a journaled reason. Do not edit SQLite directly and do not run CoreProtect rollback, `//regen`, or bulk clears.
6. Verify the released IDs, surviving claims, LiveMap marker removal, and reclaim behavior. Remove the actor and any test claim afterward.

The audit helper and generated report are local, ignored files under `.cache/` in this worktree; they are not deployment inputs.

## Acceptance remaining

- Exact-head CI, artifact publication, and ArgoCD reconciliation.
- Production LiveMap click behavior and HTTP 200.
- Reviewed candidate set, completed backup, released claims, and live reclaim verification.
