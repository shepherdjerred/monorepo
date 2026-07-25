---
id: log-2026-07-18-seerr-tv-request-quota-corruption
type: log
status: complete
board: false
---

# Seerr: users can request movies but not TV — corrupted quota columns

## Report

A user reported (2026-07-17) that they can request movies but not TV shows in seerr.

## Diagnosis

This is [seerr-team/seerr#1964](https://github.com/seerr-team/seerr/issues/1964) (and #2852): an
old Overseerr bug stored the literal column _name_ as a **text** value in the user quota columns
(`movieQuotaLimit = "movieQuotaLimit"`, `tvQuotaLimit = "tvQuotaLimit"`, etc.). The corrupted
values break the TV request quota check for any user without admin-level permissions; movie
requests still go through, which matches the report exactly. Users with the "Manage Users"
permission bypass quota, which is why the admin account is unaffected.

Verified against the live instance (v3.3.0, `media/media-seerr` pod, SQLite at
`/app/config/db/db.sqlite3` — copied out read-only via `kubectl cp`):

- All 8 users have `typeof(movieQuotaLimit|movieQuotaDays|tvQuotaLimit|tvQuotaDays) = 'text'`
  with the column name stored as the value.
- User 1 (`plex@sjer.red`, permissions=2 = admin) works because admin bypasses quota.
- A `db.sqlite3.pre-migration` file exists on the PVC — this DB went through the
  Overseerr→seerr migration.

Upstream fixed this in seerr **3.2.0** via [PR #2863](https://github.com/seerr-team/seerr/pull/2863),
but that fix lives in `server/lib/overseerrMerge.ts` — it only sanitizes quota values **during the
Overseerr import flow**, not as a schema migration on upgrade. Our DB was migrated before 3.2.0,
so running v3.3.0 does not repair it.

## Fix (maintainer-recommended, from the issue thread)

Stop seerr, then run against `/app/config/db/db.sqlite3`:

```sql
UPDATE user SET movieQuotaLimit = NULL WHERE typeof(movieQuotaLimit) = 'text';
UPDATE user SET movieQuotaDays  = NULL WHERE typeof(movieQuotaDays)  = 'text';
UPDATE user SET tvQuotaLimit    = NULL WHERE typeof(tvQuotaLimit)    = 'text';
UPDATE user SET tvQuotaDays     = NULL WHERE typeof(tvQuotaDays)     = 'text';
```

Users then fall back to the global quota defaults.

Homelab-specific notes for applying:

- The seerr container image has **no sqlite3 CLI**; run the queries via a temporary debug
  container/pod mounting the `seerr-pvc` PVC, or a `node` one-liner in the pod using seerr's
  bundled sqlite driver.
- Single-node cluster + ArgoCD: scaling the deployment to 0 gets reverted unless the
  Application is paused first (or run the queries during a brief window — SQLite is in WAL
  mode, so writing while seerr is up risks stale reads/locks; stopping it is the safe path).
- A pre-fix DB backup was copied to the session scratchpad; take a fresh on-PVC copy
  (`cp db.sqlite3 db.sqlite3.pre-quota-fix` plus wal/shm) before running the UPDATEs.

## Verification plan (after fix)

1. Re-run the `typeof(...)` SELECT — all four columns should be `null` for every user.
2. Have a non-admin user (or a test account) request a TV show; confirm it succeeds.
3. Confirm movie requests still work.

## Fix applied — 2026-07-18

Executed the maintenance window end-to-end:

1. Paused ArgoCD auto-sync on the `media` Application
   (`kubectl patch application media -n argocd` → `syncPolicy.automated: null`).
2. Scaled `media-seerr` to 0 and waited for the pod to fully terminate.
3. Ran a temporary `alpine:3.22` debug pod (`seerr-db-fix`) mounting `seerr-pvc` at `/data`.
4. On-PVC backups taken first: `db.sqlite3.pre-quota-fix`, `db.sqlite3-wal.pre-quota-fix`,
   `db.sqlite3-shm.pre-quota-fix` (ownership preserved with `cp -p`). An off-cluster copy of
   the pre-fix DB also sits in the session scratchpad.
5. Ran the four UPDATEs + `PRAGMA wal_checkpoint(TRUNCATE)` via sqlite3.
6. Verified: `typeof(...)` is `null` for all four quota columns across all 8 users.
7. `chown 1000:1000` on the db files (sqlite ran as root), deleted the debug pod.
8. Scaled seerr back to 1 — rollout succeeded, logs clean ("Server ready on port 5055"),
   public API returns 200.
9. Re-enabled auto-sync; `media` app is Synced with zero non-healthy resources.

Remaining human verification: have the reporting user retry a TV request (admin accounts
bypass quota, so an agent-side request can't reproduce the non-admin path). If anything looks
wrong, restore by stopping seerr and copying the `.pre-quota-fix` files back over the live ones.

## Session Log — 2026-07-18

### Done

- Root-caused "users can request movies but not TV" to corrupted Overseerr-era quota columns
  (seerr-team/seerr#1964, #2852); confirmed against the live DB.
- Established that the upstream 3.2.0 fix (PR #2863) only runs during Overseerr import, so
  v3.3.0 never repaired our already-migrated DB.
- Applied the maintainer-recommended SQL fix to prod with ArgoCD paused, seerr stopped, and
  on-PVC backups taken; verified columns clean; restored service and auto-sync.

### Remaining

- ~~Ask the reporting user to retry a TV show request~~ — **confirmed working 2026-07-18**.
- The `*.pre-quota-fix` backup files in `/app/config/db/` on `seerr-pvc` can be deleted
  whenever (also `db.sqlite3.pre-migration` if no longer wanted). Left in place for now.

### Caveats

- Non-admin request flow could not be exercised directly (no non-admin credentials); the fix
  matches the maintainer's exact remediation and the DB state now matches the expected shape.
- Global quota defaults now apply to all users (previously the corrupted per-user values were
  in place); if any user had a real per-user quota, it was already broken and is now unset.
