---
id: log-pr-fleet-controller-prompt-review-2026-07-29
type: log
status: complete
board: false
---

# PR Fleet Controller Prompt Review

Reviewed the proposed PR fleet controller as prompt design only. No controller,
subagent, PR, CI, branch, or scheduled-task action was executed.

The first revision incorrectly made the desktop/web Scheduled interface a hard
gate. The execution trace showed that this caused Codex to stop before fleet
inventory or worker fan-out whenever the running agent lacked Scheduled-task
controls.

The corrected Codex prompt should explicitly create an unbudgeted Goal and keep
the controller turn alive. It should use the agent-mailbox wait capability with
a five-minute timeout, which wakes early for subagent results and otherwise
drives the next fleet tick. A desktop Scheduled task may be an optional outer
safety net, but it must never block the in-process controller.

When the agent-mailbox wait cannot provide the timer, the controller may use
exactly one harness-tracked background `sleep 300` task as a heartbeat
backstop. The background task must re-invoke Codex when it completes; an
ordinary detached shell process is not sufficient. Foreground sleep,
`sleep 300 && <command>`, and overlapping timers remain disallowed.

The controller should use capability-based subagent operations, maintain one
logical owner per actionable PR, cap actual concurrent workers to the lower of
five and the runtime limit, serialize dependency installation, and dynamically
reconcile new and closed PRs. Direct conflict checks must use `git merge-tree`,
not ancestry.

## Session Log — 2026-07-29

### Done

- Reviewed the controller and worker prompts without executing them.
- Verified current Codex scheduling and subagent capabilities against the Codex
  manual.
- Replaced the failed Scheduled-task hard gate with a Codex Goal plus
  five-minute agent-mailbox heartbeat.
- Added a single harness-tracked background `sleep 300` as the last-resort
  heartbeat backstop.
- Revised the worker-template boundary so worker-only return instructions do
  not terminate the controller.
- Preserved dynamic fleet reconciliation, bounded fan-out, and current Codex
  model guidance.

### Remaining

- Run the corrected prompt manually in Codex and confirm that it creates the
  Goal, fans out workers, and returns to the fleet tick after the first
  five-minute mailbox timeout.

### Caveats

- The Goal plus mailbox wait is an in-process controller heartbeat. An optional
  desktop Scheduled task is still useful for recovery after the Codex
  process or machine stops, but its availability must not gate fleet work.
- The changed log passed Prettier. Repository-wide docs verification could not
  complete because the root has no `check-docs` script and `check-todos`
  currently stops on
  `plans/2026-07-29_scout-season-expiry-outage.md`, whose in-progress board state
  has no unchecked item under `## Remaining`.
