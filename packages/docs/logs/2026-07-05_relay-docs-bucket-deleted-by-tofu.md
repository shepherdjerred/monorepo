# Relay crashloop — `relay-docs` S3 bucket deleted by cross-checkout `tofu apply`

## Status

Complete

## Summary

The `relay` deployment (self-hosted y-sweet Yjs sync server at `relay.sjer.red`, for
Obsidian real-time collaboration) was in `CrashLoopBackOff` with:

```
Error: Store bucket does not exist. Bucket does not exist.
```

Root cause was **not** the missing bucket per se — it was that the `relay-docs`
SeaweedFS bucket had been **explicitly deleted by a tofu destroy** triggered by the
classic Terraform/OpenTofu "global state vs. per-checkout config" footgun.

## Diagnosis (evidence chain)

1. Bucket absent from `aws s3 ls --profile seaweedfs`, the filer `/buckets` dir, and
   git/tofu on `main`.
2. Loki (`{namespace="seaweedfs"} |= "relay-docs"`) showed `relay-docs` was a **real,
   populated collection** — volumes 477–483 with actual needle data (Obsidian CRDT
   docs). So relay had been healthy earlier and written data.
3. At **2026-07-05 03:34:49 UTC**, the S3 gateway logged
   `s3api_bucket_handlers.go:388 delete collection: collection:"relay-docs"` —
   i.e. an authenticated **S3 `DeleteBucket`** removed all 7 volumes + the collection.
   This is exactly the API call Terraform issues when destroying an `aws_s3_bucket`.
4. `git log --all -S relay -- .../tofu/seaweedfs/` → commit **`fdb6789d9`** on branch
   **`feature/homelab-relay-server`** (NOT merged to main) added the whole relay stack
   **including `aws_s3_bucket.relay_docs` in `buckets.tf`**.
5. A node reboot ~90 min later (05:18 UTC, all node pods restarted via `SandboxChanged`)
   was a **red herring** — unrelated to the deletion.

### What happened

- Relay + its bucket were deployed by running `tofu apply` **from the feature branch**,
  which recorded `relay_docs` in the **shared** tofu state (`homelab-tofu-state` bucket —
  one global state for all checkouts).
- A later `tofu apply` ran from a checkout **without** `relay_docs` (main, or the branch
  after the 2026-07-04 stash-conflict-reconcile). tofu saw `relay_docs` in state but not
  in config → **destroyed it** (DeleteBucket at 03:34:49), and removed it from state.

**Footgun:** tofu state is global, config is per-checkout. Applying from a feature branch
then applying from main reverts everything the branch added — including deleting
data-bearing buckets.

## Fix applied

- `aws s3 mb s3://relay-docs --profile seaweedfs` (manual recreate).
- `kubectl -n relay rollout restart deploy/relay` → new pod `1/1 Running`, 0 restarts,
  past the bucket check, `Listening on ws://0.0.0.0:8080`.

A manually-created bucket is safe from normal `main` applies (it's in neither state nor
config, so tofu ignores it). It re-enters the danger zone only if someone runs
`tofu apply` from `feature/homelab-relay-server` again (pulls it into state), then applies
from main (destroys it).

## Session Log — 2026-07-05

### Done

- Root-caused relay CrashLoopBackOff to a tofu cross-checkout destroy of `relay-docs`
  (Loki + git evidence; delete at 03:34:49 UTC via S3 DeleteBucket).
- Recreated the `relay-docs` bucket manually and restarted relay; service healthy.

### Remaining

- **Data loss:** Obsidian CRDT docs written before 03:34:49 UTC were in the deleted
  volumes and are gone. Only recovery path is a Velero backup of the `seaweedfs-volume-0`
  PVC from before that timestamp — not yet checked.
- **Durable fix not done:** relay is running in-cluster from the unmerged
  `feature/homelab-relay-server` branch; its IaC (cdk8s + `relay_docs` bucket + Cloudflare
  DNS) is absent from main. Until the stack (or at least the bucket resource, ideally with
  `lifecycle { prevent_destroy = true }`) is merged to main, the manual bucket stays
  fragile to the same branch→main apply sequence.

### Caveats

- The node reboot at 05:18 UTC was coincidental, not causal — initial theory (empty bucket
  lost to leveldb async-write on ungraceful reboot) was wrong once the user noted the
  bucket predated the reboot by hours.
- SeaweedFS filer uses `leveldb2` (async writes) on a persistent `zfs-ssd` PVC; durability
  was never the issue here.
