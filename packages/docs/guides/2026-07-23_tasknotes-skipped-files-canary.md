---
id: guide-2026-07-23-tasknotes-skipped-files-canary
type: guide
status: complete
board: false
---

# TaskNotes skipped-files canary

The tasknotes-server engine skips (and loudly reports) any task-like vault
file it cannot parse — but nothing watches that signal. The 2026-07-12
Obsidian-Sync conflict corruption of `pay-rent.md`/`pay-airvpn.md` made two
tasks invisible in the app for **10 days** before a manual inspection found
them (`logs/2026-07-22_tasknotes-sync-conflict-repair.md`). This canary
closes that gap: same-day detection instead of accidental discovery.

## The check

```bash
# In-cluster (no token needed from inside the pod):
kubectl exec -n tasknotes deploy/tasknotes -c tasknotes-server -- \
  bun -e 'const tok = Object.entries(process.env).find(([k])=>/token/i.test(k))?.[1];
    const r = await fetch("http://localhost:3000/api/engine-status", {headers:{Authorization:`Bearer ${tok}`}});
    const j = await r.json(); console.log(JSON.stringify(j.data))'
```

Healthy: `skippedFiles: []`. Any entry means a vault file the server cannot
parse — usually YAML corrupted by an Obsidian Sync line-wise conflict merge
(duplicate map keys, fused lines). Repair procedure: see the 2026-07-22 log
(back up bytes, deduplicate frontmatter keeping completions + latest
schedule, `touch` to nudge the watcher, verify task count + 200s).

## Scheduled check

<!-- temporal-agent-task
{
  "title": "TaskNotes skipped-files canary",
  "provider": "claude",
  "mode": "report-only",
  "cron": "0 9 * * *",
  "scheduleId": "tasknotes-skipped-files-canary",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/guides/2026-07-23_tasknotes-skipped-files-canary.md"
  },
  "prompt": "Run the kubectl engine-status check from 'The check' section of the source doc against the tasknotes namespace. Email the result: green if skippedFiles is empty and the fetch succeeded; red with the full skippedFiles list (path + reason) if not, plus a reminder that the repair runbook is in packages/docs/logs/2026-07-22_tasknotes-sync-conflict-repair.md. Also flag if the pod is not Running or the tasks count dropped more than 20% since the last report."
}
-->

Operator step to (re)schedule:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts \
  --from-doc ../../packages/docs/guides/2026-07-23_tasknotes-skipped-files-canary.md
```
