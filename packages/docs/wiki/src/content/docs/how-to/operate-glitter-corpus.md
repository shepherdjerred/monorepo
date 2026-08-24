---
title: Operate the Glitter corpus
description: Approve a channel inventory, run a backfill, and let the daily capture take over.
sidebar:
  order: 6
---

Glitter's Discord corpus is operator-gated on purpose. A full backfill costs
real Discord rate-limit budget, so nothing backfills until you approve the exact
scope.

Run every action from `packages/temporal`. Set `TEMPORAL_ADDRESS` to the
operator-reachable TLS endpoint from private configuration; do not publish that
hostname. External connections also require `TEMPORAL_TLS=true`.

## 1. Take an inventory

Run the inventory action. It lists channels and scope decisions and writes them
as an immutable object.

```bash
cd packages/temporal
TEMPORAL_ADDRESS=<private-temporal-host>:443 TEMPORAL_TLS=true \
  bun run glitter:operate inventory
```

Read it. This is the moment to decide what is in and out of the corpus — after
backfill it is captured.

## 2. Approve it by key and checksum

Approve the inventory by its key **and** checksum. The checksum is the point: it
guarantees you approved the scope you actually read, not whatever the inventory
says now.

Only after approval may the full backfill run.

To prove one channel first, use the canary action with the approved guild and
channel identifiers:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=<private-temporal-host>:443 TEMPORAL_TLS=true \
  bun run glitter:operate canary \
  --guild-id=<guild-id> \
  --guild-slug=<guild-slug> \
  --channel-id=<channel-id>
```

## 3. Backfill

Run the backfill action. Each channel is traversed backward and forward
independently, and the two traversals are checked against each other for
completeness.

Use the exact key and SHA-256 printed by the inventory action:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=<private-temporal-host>:443 TEMPORAL_TLS=true \
  bun run glitter:operate backfill \
  --inventory-key=<inventory-key> \
  --inventory-sha=<inventory-sha256> \
  --wait=true
```

Everything is written content-addressed under its sha256, once. Retries re-read
rather than corrupt, and nothing is ever overwritten.

Discord access is serialized to one request per second globally by a
compare-and-swap lease object in S3, so a backfill will not starve other
workflows.

## 4. Let the daily capture take over

Daily capture at 04:15 re-fetches only the last 7 days and merges onto the prior
snapshot. That is cheap and tolerant of edits and late-arriving messages.

After 6 consecutive overlap runs a channel is fully re-backfilled, which bounds
how far accumulated drift can go. That re-backfill is spawned as a child of the
daily capture; you do not trigger it.

## Note on the context refresh

`glitter-context-refresh` is a separate scheduled workflow rather than one of
the operator actions above. It distills the corpus into per-person context and
opens a PR that is always human-reviewed.

One person's evidence failing no longer fails the run. A card the model cannot
produce is listed as skipped in the result and in the PR body, and the other
people are still refreshed; only a run where nobody was refreshed fails.

To reproduce a refresh locally — against the real corpus and the real generation
cache, without a Temporal server or a worker deploy — run the diagnostic harness.
It stops before opening a PR unless you ask for a real run:

```bash
cd packages/temporal
bun run glitter:refresh-local \
  --dry-run=true \
  --max-cost-usd=50 \
  --snapshot-id=<snapshot-id> \
  --snapshot-sha256=<snapshot-sha256>
```

It needs `GLITTER_DISCORD_GUILD_ID`, the `GLITTER_CORPUS_S3_*` credentials, and
`OPENROUTER_API_KEY`; `--dry-run=false` additionally needs the `GITHUB_APP_*`
credentials because it opens the PR. Cached generation artifacts are keyed by
request digest rather than by run, so a local run reuses everything a production
run already paid for. Pin `--snapshot-id`/`--snapshot-sha256` to reuse the most
cache; omit both to read the latest verified snapshot.

The weekly schedule passes a $40 uncached-cost kill switch. Operator
invocations that omit `maxEstimatedCostUsd` still default to $10. A
preflight estimate, per-call authorization, and post-call ceiling enforce
the cap. A completion that returns without usage data fails non-retryably
rather than risk re-charging.

## Related

- [Temporal workflow inventory](/reference/temporal-workflows/) — the Glitter workflows
- [Birmel](/explanation/birmel/) — what the context is for
