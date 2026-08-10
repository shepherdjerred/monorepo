---
title: Run the PR fleet
description: Start the controller over your open pull requests, steer it while it works, and answer the questions it raises.
sidebar:
  order: 1
---

The PR fleet controller drives every open pull request toward "ready for a
human". It runs in the foreground and you steer it conversationally.

It never merges, closes, or approves anything. You still land the work
yourself.

## 1. Start it

```bash
bun run pr:fleet \
  --model <provider>/<model-id> \
  --author shepherdjerred
```

`--author` adds your own drafts to the fleet and keeps bot-authored PRs out.
Drop it to take every open PR.

Pick one model; it powers both the conversational master and every worker.

## 2. Watch it

A live dashboard builds and opens on loopback by default — a fleet overview
plus a per-PR transcript including the model's reasoning.

| You want            | Flag            |
| ------------------- | --------------- |
| No dashboard at all | `--no-ui`       |
| A fixed port        | `--ui-port <n>` |
| No browser window   | `--no-open`     |

The dashboard is torn down when the run finalizes. To reopen it later, see
[Inspect a fleet run](/how-to/inspect-a-fleet-run/).

## 3. Steer it

| Input                         | Effect                  |
| ----------------------------- | ----------------------- |
| `/status`                     | current fleet state     |
| `/tick`                       | force a scheduling pass |
| `/questions`                  | list open questions     |
| `/answer <request-id> <text>` | answer one question     |
| `/stop`                       | shut down               |
| anything else                 | conversational steering |

## 4. Answer its questions

A worker suspends its PR — and only that PR — when it needs a decision. The
rest of the fleet keeps moving.

Answer from the terminal with `/answer`, or from the PR's detail view in the
live dashboard. Both work; the dashboard form is bound to that PR's exact head.

:::caution
An unanswered question is superseded automatically if the head moves, the PR
goes green, or the PR closes. If you push while a question is open, expect to
be asked again against the new commit.
:::

Questions worth expecting: ambiguous ownership of a local checkout, mixed
staged work, an uncertain history rewrite, or two meaningfully different valid
fixes.

## If you already have a branch checked out

The controller provisions its own worktree per stack. Git forbids the same
branch in two worktrees, so if you already have a PR's branch checked out it
reuses your checkout in place rather than parking the PR for the whole run.

It will not reset a matching branch. Unrelated unstaged files stay local.

## Related

- [PR fleet CLI](/reference/pr-fleet-cli/) — every flag
- [Inspect a fleet run](/how-to/inspect-a-fleet-run/)
- [What the fleet may and may not do](/explanation/pr-fleet-authority-boundary/)
