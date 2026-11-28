# Experiments

Experiments stores the hypothesis, evidence, and decision for a trial. The
primary browser surface is **Hub → Experiments**. The standalone tailnet
service serves the same pages and hosts the API used by Hub and Toolkit.

Use a draft to describe the change, affected scope, how it will be measured,
and what would count as success. Start saves the original plan. Record
observations and amendments while the trial runs. When the review is due,
record the reasoning and decide whether to keep, revert, extend, or mark the
result inconclusive. Due dates are Pacific calendar dates. Decisions and
amendments retain their revision, timestamp, and actor in the audit history.

Tracker, Flags, and external evidence are references. Apply any resulting flag
change or follow-up through the owning service. See the [Toolkit commands](../toolkit/README.md#experiments)
for action examples and JSON payloads.

## Service boundaries

- PostgreSQL stores records, history, and request receipts. Record changes and
  their audit events commit together. Writes to existing records check the
  expected revision. Retrying with the same request ID and payload returns the
  recorded response.
- `@shepherdjerred/experiments/contract` exports the schemas and paths for the
  JSON API rooted at `/api/v1/experiments`. Responses include the revision
  clients need before making a subsequent write.
- The standalone API accepts verified tailnet operators and the brokered
  Toolkit credential. The private listener accepts Hub calls with a dedicated
  service credential and provides a read-only due count for Ops Snapshot.

## Development

```bash
bun run generate
bun run dev -- --fixture
bun run typecheck
bun run lint
bun run test
bun run test:extended
```

Fixture mode serves the browser against disposable data. For database-backed
development, provide a dedicated `DATABASE_URL` and the local service
credentials through the configured broker, run `bun run migrate:deploy`, and
start `bun run dev`. Use the hosted-service release path for live changes.

## Activation

Publish the prepared image and chart through Delivery. On activation, register
the private tailnet host and `experiments/prod`, then open `EXPERIMENTS_ACTIVE`.
Provision `experiments-auth` with `EXPERIMENTS_MACHINE_TOKEN` for direct Toolkit
access and `experiments-hub-auth` with `EXPERIMENTS_HUB_TOKEN` for Hub's private
connection. After the experiment service is ready, set
`experimentsHubConfig.active` to connect the Hub module and Ops Snapshot collector.
