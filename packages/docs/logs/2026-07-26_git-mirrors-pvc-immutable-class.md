---
id: git-mirrors-pvc-immutable-class
type: log
status: complete
board: false
---

# Main build 6306: git-mirrors PVC immutable storageclass conflict

Fifth leg of the get-main-green session (after
[[docs-board-trash-cleanup-ci]]). In build 6306 — where `images` and
`scout-tag-release` finally passed (first release-pair mint since the cutover)
— `argocd-sync` failed with a real, permanent config error:

```
PersistentVolumeClaim "buildkite-git-mirrors" is invalid: spec: Forbidden:
spec is immutable after creation except resources.requests
- "StorageClassName": "zfs-ssd",
+ "StorageClassName": "zfs-ssd-lz4",
```

## Root cause — migration/PR crossing window

- 2026-07-25 ~17:42 PT: the liskov migration (re)created `buildkite-git-mirrors`
  on liskov. The cdk8s definition at that moment said `zfs-ssd`
  (compression=off), so the claim bound with it.
- ~22:23 PT: PR #1663 flipped the definition to `NVME_STORAGE_CLASS_LZ4`
  (`zfs-ssd-lz4`, same `zfspv-pool-nvme` pool, lz4 compression — the CI
  write-reduction effort).
- No argocd-sync completed between those events and build 6306 (every build
  died earlier), so the first live apply hit Kubernetes' storageClassName
  immutability. Every sibling CI cache PVC (`buildkite-tofu-plugin-cache`,
  `buildkitd-cache-liskov`, `turbo-cache-liskov`) is already on lz4 —
  git-mirrors was the lone straggler because it kept its old name through the
  migration while the others were force-recreated via rename.

## Fix — the repo's own rename pattern, via GitOps

Per operator decision (manual `kubectl delete` declined; "we can recreate
it" via code): rename the claim `buildkite-git-mirrors` →
`buildkite-git-mirrors-liskov` in
`packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts`,
exactly like `buildkitd-cache-liskov` / `turbo-cache-liskov` (see the
buildkitd.ts comment: a new name binds fresh via WaitForFirstConsumer). The
agent-stack pod-level volume NAME stays `buildkite-git-mirrors` so
`.buildkite/pipeline.yml`'s container volumeMounts are untouched; only the
`claimName` moves. The old claim is pruned by the argocd-sync step's
`sync apps --prune`. Data is a disposable mirror cache (velero-excluded);
it re-warms in ~52s/pod on the next build.

Verified: `bunx turbo run build test --filter=@homelab/cdk8s` green; rendered
`dist/apps.k8s.yaml` carries the new PVC name and claimName.

## Session Log — 2026-07-26

### Done

- Diagnosed the immutable-storageclass sync failure end-to-end (live PVC/PV
  inspection, storage class params, commit archaeology across #1629/#1663).
- Renamed the git-mirrors PVC to `-liskov` with the lz4 class (worktree
  `fix/git-mirrors-liskov-pvc`).

### Remaining

- Merge, then the next main build's argocd-sync creates the new claim and
  prunes the old; watch it to green.

### Caveats

- Until the merge lands, every argocd-sync on main keeps failing on this diff.
- First build after merge pays cold git mirrors (~52s per step pod, once).
- Known flakes to watch (not blockers, retry if hit): dvs pacing test
  wall-clock bound; buildkitd OOM at 12Gi under full-fleet cold bakes.
