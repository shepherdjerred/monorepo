---
name: linear-helper
description: Safely use Linear's CLI, API, MCP, and work-management features for this repository. Trigger for Linear issues, projects, cycles, initiatives, plans, triage, automations, or Linear-connected agents.
---

# Linear Helper

Use Linear as the repository's system of record for plans, open work, review
queues, and follow-ups. `toolkit linear` delegates to the native CLI and
supplies workspace `sjerred` (`monorepo`) unless an explicit workspace is
passed. This skill is intentionally operational; consult the focused
references before unfamiliar API, agent, or portfolio work.

## Authenticate and discover

The configured Fish environment supplies `LINEAR_API_KEY` through 1Password.
It is deliberately not a CLI-managed login.

```bash
toolkit linear --version
toolkit linear auth whoami
toolkit linear auth list
toolkit linear --help
toolkit linear issue --help
```

- Never run `toolkit linear auth token`: it prints a credential.
- Do not run `toolkit linear auth login` unless the user explicitly requests a change
  to the credential-management boundary.
- Outside the configured shell, repair the dotfiles path; do not paste or save
  a token. `op whoami` alone is not a useful probe for Desktop integration.
- Pass an explicit `--workspace` only when intentionally targeting a different
  workspace.

For the installed CLI's command groups and raw GraphQL escape hatch, read
[CLI and API workflows](references/cli-and-api.md). The CLI is a convenient
operator surface, not a reason to guess arguments: use `--help` on the exact
command before an unfamiliar call.

## Read work before acting

Start with a precise identifier from the user, repository metadata, or the
current branch. Do not infer an issue from a similar title.

```bash
toolkit linear issue id
toolkit linear issue view SJ-123
toolkit linear issue list --team <team-key>
toolkit linear issue mine --team <team-key>
toolkit linear team list
toolkit linear project list
toolkit linear cycle list --team <team-key>
toolkit linear initiative list
```

Use the appropriate object for the question:

- **Issue:** a discrete, owned deliverable; keep title, owner, status, and
  acceptance context current.
- **Project:** a coordinated outcome spanning issues; use project updates for
  status, risks, and decisions instead of repeating issue detail.
- **Cycle:** a bounded team planning window, not a substitute for a project.
- **Initiative:** a strategic portfolio outcome that groups projects.
- **Triage:** the intake buffer for unplanned work; qualify and route it before
  it enters active delivery.

`issue id` resolves only an identifier encoded in the current branch. The list
and cycle commands need `--team <team-key>` unless the repository has a Linear
default team configured; discover the key with `toolkit linear team list`.

Read [work-management workflows](references/work-management.md) for the
object model, intake, planning, and GitHub handoff. It is grounded in the
official docs plus five clearly labelled practitioner examples.

## External-write boundary

Creating or changing Linear state is an external write. Do it only when the
user has asked for it or the task explicitly authorizes it. First inspect the
target and verify the exact team, project, state, labels, assignee, and issue
identifier. Then discover the exact CLI form:

```bash
toolkit linear issue start SJ-123
toolkit linear issue update --help
toolkit linear issue comment --help
toolkit linear issue create --help
toolkit linear project update --help
```

Use `issue start` only when active work is authorized. Create an issue only for
durable, worthwhile work; never create a session diary. Feature branches and
pull requests still use the repository's git-spice workflow. A Linear/GitHub
integration must not bypass that boundary or imply that a PR is merged or
deployed.

## API, MCP, and agents

Use the official API/webhooks or MCP only when the CLI cannot express the
needed operation. Treat agent access as scoped automation, not blanket
authority:

1. Read the target issue/project and state the intended change.
2. Use the minimum read scope and query shape necessary.
3. Require the same explicit authorization for a mutation that a human CLI
   call would require.
4. Re-read the changed object and report the result.

Prefer official workflow, GitHub, and webhook integrations over brittle polling.
For agent/MCP capability, webhook design, and the current product releases,
read [agents and integrations](references/agents-and-integrations.md).

## Safety checks

- Never print keys or place credentials in an issue, comment, file, or command
  output.
- Keep planning and unfinished-work tracking in Linear; do not create parallel
  repository-local task ledgers.
- Treat every write as a state transition with an auditable target and outcome.
- If a command or feature is newer than the local CLI, consult its help and the
  source ledger rather than fabricating a compatible command.

The dated, deduplicated 50-source corpus is in
[the Linear source ledger](references/sources.md). It is evidence, not an
instruction to apply a vendor workflow where repository policy is stricter.
