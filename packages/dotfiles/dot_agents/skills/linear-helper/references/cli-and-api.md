# Linear CLI and API workflows

Use the installed CLI as the first operator interface. Its version and command
set are local facts, so discover them before relying on examples from the web.

```bash
toolkit linear --version
toolkit linear --help
toolkit linear issue --help
toolkit linear api --help
toolkit linear schema --help
```

## Read workflow

1. Establish the selected account with `toolkit linear auth whoami`.
2. Resolve an exact issue identifier with `toolkit linear issue id`, a user-provided
   identifier, or an inspected list/search result.
3. Read the object before proposing or performing a state transition.
4. Use the narrowest object-specific command: issue, project, cycle,
   initiative, document, or update.

The CLI exposes commands for issues, teams, users, projects and project
updates, cycles, milestones, initiatives and initiative updates, labels, and
documents. Ask its `--help` for parameter spelling; do not port a GraphQL field
name directly into a CLI flag.

## API and webhook workflow

The official API is GraphQL and webhooks are an event-delivery mechanism. Use
them when a tested script or integration needs something the CLI cannot do.

1. Define the read model or exact authorized mutation first.
2. Query only fields needed for that model and paginate deliberately.
3. Validate webhooks, deduplicate deliveries, and make handlers idempotent.
4. On mutations, re-read the resource and record the resulting identifier or
   state rather than assuming delivery succeeded.

Use a restricted token and never put it in repository configuration, a query,
or a log. Token rotation and access review belong to the credential owner.

## Raw API boundary

`toolkit linear api` is a raw escape hatch, not permission to issue broad mutations.
Before using it, inspect `toolkit linear api --help` and `toolkit linear schema --help`, then
prefer a small, read-only query. For a write, require explicit authorization,
inspect the current object, send one exact mutation, and re-read it. Keep the
GraphQL query in a reviewed script when it becomes recurring automation.

## Useful references

- [API and webhooks](https://linear.app/docs/api-and-webhooks) — official
  entrypoint for API and webhook setup.
- [Linear developer webhooks](https://linear.app/developers/webhooks) — event
  subscription and delivery reference.
- [Concepts](https://linear.app/docs/conceptual-model) — object relationships
  that should drive query shape.
- [Source ledger](sources.md) — dated evidence for the current command and
  automation guidance.
