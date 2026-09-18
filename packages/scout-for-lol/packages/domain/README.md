# @scout-for-lol/domain

Pure domain contracts for Scout: branded identities, versioned codecs, and
state-machine schemas. Every module here depends on zod and nothing else, so
any Scout workspace can import a contract without dragging in Prisma, Discord,
Riot, or S3.

`src/` is stratified one way, and `architecture.config.ts` enforces it:

```text
identity → codec → artifacts → match-processing → notifications → recovery
```

A later layer may import an earlier one, never the reverse. `identity` is the
root: it may import zod and its own siblings, nothing else.

## Workflow start requests

`src/recovery/workflow-start.ts` is the contract for a recorded request to
start a Temporal Workflow, and `workflow-start-transitions.ts` its pure
transitions. One record per _request_, keyed by `WorkflowStartRequestId`: V2
Workflow ids derive from identity alone, so one Workflow is requested many
times over its life and the id is what those requests share.

| Phase       | Lifecycle | On a new request for the same Workflow id |
| ----------- | --------- | ----------------------------------------- |
| `requested` | in-flight | adopted — the requester wants that start  |
| `accepted`  | terminal  | succeeded — a new request is recorded     |

`accepted` is terminal even while the Workflow runs: acceptance ends the
handoff, and from then on Temporal's conflict and reuse policies govern the
id. Persistence mirrors the in-flight half with a partial unique key, but the
table above is defined here and applied only by the transition functions.

## Bryan Bucks money brands

`src/identity/bucks-money.ts` is authoritative for what a Bryan Bucks quantity
_means_. Whether a quantity also fits the Prisma `Int` column it will be stored
in is a separate question, owned by `@scout-for-lol/data` — see that package's
README for the storability edge.

| Brand            | Shape                                              |
| ---------------- | -------------------------------------------------- |
| `BucksStake`     | positive whole-BB commitment; zero is not a stake  |
| `BucksAmount`    | non-negative whole-BB quantity; zero is legitimate |
| `BucksDelta`     | signed, non-zero ledger movement                   |
| `BucksPoolTotal` | non-negative sum across many positions             |

None of them carries a storage bound. They stop at the IEEE-754 safe-integer
range, which `z.number().int()` already enforces — the point past which a sum
stops being exact.

That is the whole reason the brands live apart from storability. A pool
aggregate sums many bettors' positions and may legally exceed Int32 while every
contributing position is perfectly storable. When the two concerns were fused,
such an aggregate could not be branded at all, so settlement fell back to bare
`number` and lost every guarantee the brands provide. `BucksPoolTotal` exists
because the split lets it.

`BucksPoolTotal` and `BucksAmount` are deliberately not interchangeable: both
are non-negative integers, so only the brands keep a multi-bettor sum out of a
field destined for one bettor's storage column.

The checked arithmetic that produces these values (`addAmounts`,
`subtractAmounts`, `applyDelta`, `creditOf`, `debitOf`, `stakeToAmount`,
`amountToStake`, `sumToPoolTotal`) lives here too, because it is pure and
re-asserts only the semantic domain.
