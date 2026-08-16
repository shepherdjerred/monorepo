# Linear agents and integrations

Linear's current agent surfaces include MCP, Linear Agent, coding sessions,
code intelligence, agent-assisted edits, and project updates. They make
structured work easier to inspect and update, but they do not change the
repository's authorization rules.

## Agent operating model

1. Read the issue, project, or initiative before producing a plan or action.
2. Make the intended change explicit and keep it inside the user's authority.
3. Provide bounded context: the relevant object, acceptance criteria, linked
   code/reviews, and current state—not an unfiltered workspace dump.
4. Verify output against source control, CI, and runtime evidence. Agent prose
   and a Linear status are not deployment proof.
5. Record durable work and decisions in Linear; do not emit a session journal.

## Integration choices

- **GitHub:** link code and reviews to the issue; retain git-spice for feature
  branch and PR lifecycle actions.
- **MCP:** prefer the official server for interactive, least-privilege access.
  Reads are safe by default; a mutation still requires explicit approval.
- **Webhooks:** use for event-driven integrations, with signature validation,
  idempotency, and retries that do not duplicate work.
- **Asks and intake integrations:** route requests into owned triage, then
  qualify them before starting engineering work.

## Current capability watchlist

The 2026 changelog documents team initiatives, Loops, agent-assisted editing,
agent-assisted project updates, coding sessions, team documents, Diffs, code
intelligence, and Linear Agent MCP support. Consult the dated ledger before
designing a workflow around one: availability can be plan- or rollout-specific.

The official Linear Agent articles and the practitioner MCP examples are useful
for context, but neither authorizes an agent to create, reprioritize, or close
issues on its own. See [the source ledger](sources.md), especially entries
27–45 and 47–50.
