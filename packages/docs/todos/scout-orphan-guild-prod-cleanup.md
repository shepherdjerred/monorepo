---
id: scout-orphan-guild-prod-cleanup
status: waiting-on-verification
origin: packages/docs/archive/completed/2026-06-19_scout-guild-removal-lifecycle.md
source_marker: false
---

# Scout: clean up the orphaned `_hydr0o_` guild in prod + resolve Bugsink

After the guild-removal-lifecycle PR deploys to `scout-prod`:

1. The daily 5 PM Pacific `ChannelSendError` came from an orphaned competition
   report for `serverId 1345142904942760018` (channel `1455597334636265679`),
   owner `_hydr0o_`. The bot already left that guild, and `ownerNotified=1` means
   the abandoned-guild sweep will **not** pick it up — so it must be cleaned up
   explicitly once.

2. Run a one-shot cleanup in the pod (uses the new shared routine):

   ```bash
   kubectl exec -n scout-prod <scout-backend-pod> -- bun -e '
     import { cleanupRemovedGuild } from "#src/league/tasks/cleanup/remove-guild.ts";
     import { prisma } from "#src/database/index.ts";
     console.log(await cleanupRemovedGuild(prisma, "1345142904942760018"));
   '
   ```

   (If module resolution from `-e` is awkward, run an equivalent `bun:sqlite`
   delete or a small script committed to `scripts/`.)

3. Confirm no new events on Bugsink issue `b0de3030-c8b3-4cdb-bb93-7e908ee67920`
   after the next `00:00 UTC` (5 PM Pacific), then resolve it via the Bugsink web
   UI bulk action (the REST API is read-only for issues).

4. Sanity check `DmAuditLog` is recording rows (e.g. any outreach/abandonment
   DMs) to confirm the audit chokepoint works end-to-end in prod.
