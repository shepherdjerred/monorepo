---
title: Your first agent task
description: Schedule a small report-only agent run, watch it execute, and read the email it sends you.
sidebar:
  order: 1
---

In this tutorial we will write a scheduled agent task, dispatch it to Temporal,
watch it run, and read the report it emails. Along the way we will meet the doc
block, the operator CLI, and the Temporal Web UI.

This takes about ten minutes, most of which is waiting for the run.

We will deliberately pick a trivial question, because the goal is to learn the
loop — not to get an answer.

## 1. Open a scratch document

Agent-task context normally lives in Linear. For this tutorial, create a local
scratch file at `/tmp/agent-task-tutorial-scratch.md`.

Start with a new, block-free file. Do not reuse an existing guide: the operator
CLI validates and schedules every `temporal-agent-task` block it finds.

## 2. Write the task block

Add this at the bottom of the document. Replace the `runAt` value with a time
about **three minutes from now**, in your local offset.

```md
<!-- temporal-agent-task
{
  "contractVersion": 2,
  "title": "First agent task tutorial",
  "provider": "codex",
  "mode": "report-only",
  "runAt": "2026-08-09T15:30:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "checks": [
    { "id": "package-directories", "label": "Top-level package directories", "required": true, "evidenceRequirement": "Successful structured output listing the immediate directories under packages/.", "evidenceCollectors": [{ "id": "package-tree", "kind": "command", "argv": ["git", "ls-tree", "-d", "--name-only", "HEAD:packages"], "output": "non-empty", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }] }
  ],
  "prompt": "List the top-level directories under packages/ and count them. Email the list and the count. Do not change anything."
}
-->
```

Notice the declared check, its evidence requirement, its exact command
collector, and the accepted exit code that means the observation passed. The
worker runs that argv and evaluates the expectation independently of the model.
The agent's final JSON must report the check and reference
`collector:package-directories:package-tree`. If the command fails or that
receipt is missing or uncited, the report is partial rather than clean.

Notice also `"mode": "report-only"`. That is the only mode.

## 3. Dispatch it

Port-forward Temporal, then run the scheduler against your document:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=localhost:7233 \
  bun run scripts/schedule-agent-task.ts --from-doc /tmp/agent-task-tutorial-scratch.md
```

The CLI reads the block, normalizes the input, and starts a one-off workflow
whose ID is your title plus a content hash of the input.

You should see it report the workflow it started. If it instead reports a
conflict, you have run the same input twice — change the title and try again.

## 4. Watch it in the Temporal UI

Open the Temporal Web UI over the tailnet and find your execution by title.

Because we set a future `runAt`, the workflow defers using Temporal's
`startDelay`. It will sit waiting rather than running — that wait does not
consume the run's execution timeout.

Watch it start when your time arrives. The run itself clones the repo, runs
Codex read-only over that clone, and emails the result.

## 5. Read the report

The report arrives by email. It starts with a deterministic status, then shows
the declared-check table, findings, limitations, and provenance. Confirm the
check is `passed` and cites a captured command receipt. The optional synthesis
is limited to 80 words and cannot change the status.

## 6. Try to run it again

Run the exact same dispatch command a second time.

It is rejected. An already-succeeded task ID cannot be resubmitted; the workflow
ID is a content hash, so identical input is the same task.

This is worth seeing once. Resubmitting is not a silent no-op, which means a
scheduled follow-up cannot quietly double-fire.

## 7. Clean up

Delete `/tmp/agent-task-tutorial-scratch.md`. A one-off task
that has already run leaves nothing behind, so there is nothing else to remove.

## What you did

You wrote a v2 task block with declared evidence, dispatched it, watched
Temporal defer and then execute it, read its report, and saw the conflict rule
reject a duplicate.

From here:

- Put a real follow-up next to a real document with
  [Schedule an agent task](/how-to/schedule-an-agent-task/).
- Make it recurring with `cron` and a stable `scheduleId` — every field is in
  [Agent task input](/reference/agent-task-input/).
- Understand what "report-only by policy" actually protects, and what it does
  not, in
  [Report-only by policy, not by sandbox](/explanation/temporal/agent-task-boundary/).
