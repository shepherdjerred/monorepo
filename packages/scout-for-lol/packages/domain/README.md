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

## Game results

`src/artifacts/game-result.ts` describes a completed scoreboard independently
of a Riot Match-V5 document. Participant identity namespaces are explicit and
unknown statistics are nullable. Its pure resolver gives Riot precedence,
fills only missing statistics from compatible evidence, preserves an
explicitly frozen result, and leaves contradictory peer outcomes unresolved.
Source adapters and persistence live outside this
package.

`src/artifacts/resolution.ts` gives artifact consumers explicit availability,
pending deadlines, conflict evidence, coverage and frozen-state metadata.
`src/match-processing/eligibility.ts` defines source-independent admission:
explicit history or discovery more than 15 minutes after completion is
`HISTORY_ONLY`. The policy permits historical projections and permanently
excludes live effects; `ARCHIVE_ONLY` remains the capture-only policy.

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

## Result evidence

`artifacts/game-result.ts` describes result facts independently of complete
Match-V5 coverage. Terminal scoreboards may have null participant numbers and
lobby creation, while retaining an observed completion timestamp and stated
loadout. `gameResultTimestamp` returns a stated creation or completion instant;
it does not estimate missing lobby creation. Compatible result enrichment
preserves Riot priority, known participant-number conflicts and frozen inputs.
