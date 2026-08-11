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
them (the original investigation). This canary
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

The source-defined `tasknotes-skipped-files-canary` schedule runs daily at
09:00 PT. Its deterministic workflow checks the typed engine-status response,
TaskNotes pod readiness, every skipped-file path/reason, and the task-count
change from the last healthy accepted report. Postal acceptance is necessary
but not sufficient: the first successful partial report may bootstrap the
baseline, then only complete clear reports may advance it. Attention, failed,
and other partial reports are ignored, so an unresolved count drop cannot
ratchet itself into a new healthy baseline. A missing baseline makes the first
report partial; a drop greater than 20%, any skipped file, or any unhealthy pod
is attention-worthy.

The schedule remains active after healthy runs. A human may pause it in the
Temporal UI, but the workflow never pauses or cancels itself.
