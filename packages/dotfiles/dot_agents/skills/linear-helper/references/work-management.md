# Linear work-management workflows

Use Linear's hierarchy to keep planning legible without turning it into a
second repository documentation system.

| Object | Use it for | Avoid using it for |
| --- | --- | --- |
| Issue | A discrete, owned unit of delivery | A stream-of-consciousness work log |
| Project | A coordinated outcome and status/risk communication | A replacement for every task |
| Cycle | A team planning cadence | Strategic portfolio planning |
| Initiative | A strategic outcome across projects | A bucket for unrelated work |
| Triage | Intake and qualification of unplanned work | A silently growing backlog |

## Intake and execution

1. Capture incoming work in the owning team's triage/inbox path.
2. Make the issue actionable: outcome-oriented title, sufficient context,
   owner, state, and a project or cycle only when that relationship is real.
3. Qualify duplicates, urgency, customer impact, and dependencies before moving
   it to active work.
4. Start the issue only when work begins. Keep work status in Linear and code
   status in the GitHub/git-spice workflow; neither is proof of deployment.
5. Close or update the issue with the verified outcome, not an assumed result.

## Planning and updates

Plan work at the correct altitude. A project has an outcome, scope, owner,
status, milestones/dependencies as needed, and concise updates that surface
progress, risk, and decisions. Use cycles for capacity and sequencing, while
initiatives connect several projects to a strategic goal.

Keep views and dashboards decision-oriented: a triage view, a current-cycle
view, an owned-project view, or an explicit portfolio question. Avoid building
many overlapping views that have no owner or review ritual.

## GitHub handoff

The Linear/GitHub integration can connect code, pull requests, and issues. In
this repository, feature branches and PRs still use git-spice. A linked PR is
useful context; it does not replace the required PR process and does not prove
CI, merge, deploy, reachability, or production acceptance.

## Practitioner evidence

The five practitioner entries in the ledger are not product authority. They
support these bounded patterns: start with a small shared workflow, keep triage
owned, use the backlog as the product-facing coordination layer, and encode
agent automation as explicit process rather than unchecked autonomy. See
entries 46–50 in [the source ledger](sources.md).
