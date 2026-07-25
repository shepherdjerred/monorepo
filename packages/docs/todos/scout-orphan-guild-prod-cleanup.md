---
id: scout-orphan-guild-prod-cleanup
type: todo
status: awaiting-human
board: true
verification: human
disposition: active
origin: packages/docs/archive/completed/2026-06-19_scout-guild-removal-lifecycle.md
source_marker: false
---

# Scout: clean up the orphaned `_hydr0o_` guild in prod + resolve Bugsink

## Human Verification

The `TRPCError: You are not a member of that guild` Bugsink issue
(`58109652-0f3a-4a4d-9ae7-7c77e28ba83b`) is **resolved**, last seen **2026-06-26** (quiet 2 days),
and the reconcile-removed-guilds code from PR #1269 is deployed in scout-prod. So the user-facing
symptom appears handled. The remaining item — the one-shot prod-DB row cleanup for guild
`1345142904942760018` — is a **mutation against prod data**, so I did not run it unprompted (and
scout-prod's `db.sqlite` is 10.5 GB with no in-pod `sqlite3`). Likely already moot; keep until the
prod row is confirmed gone or the owner clears it.

After the guild-removal-lifecycle PR deploys to `scout-prod`:

- The daily 5 PM Pacific `ChannelSendError` came from an orphaned competition
  report for `serverId 1345142904942760018` (channel `1455597334636265679`),
  owner `_hydr0o_`. The bot already left that guild, and `ownerNotified=1` means
  the abandoned-guild sweep will **not** pick it up — so it must be cleaned up
  explicitly once.

- Run a one-shot cleanup in the pod (uses the new shared routine):

  ```bash
  kubectl exec -n scout-prod <scout-backend-pod> -- bun -e '
    import { cleanupRemovedGuild } from "#src/league/tasks/cleanup/remove-guild.ts";
    import { prisma } from "#src/database/index.ts";
    console.log(await cleanupRemovedGuild(prisma, "1345142904942760018"));
  '
  ```

  (If module resolution from `-e` is awkward, run an equivalent `bun:sqlite`
  delete or a small script committed to `scripts/`.)

- Confirm no new events on Bugsink issue `b0de3030-c8b3-4cdb-bb93-7e908ee67920`
  after the next `00:00 UTC` (5 PM Pacific), then resolve it via the Bugsink web
  UI bulk action (the REST API is read-only for issues).

- Sanity check `DmAuditLog` is recording rows (e.g. any outreach/abandonment
  DMs) to confirm the audit chokepoint works end-to-end in prod.
