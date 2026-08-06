---
id: plan-2026-07-26-glitter-discord-source-of-truth
type: plan
status: complete
board: false
---

# Glitter Discord Source of Truth and Shared Context

## Goal

Build an exact, durable source of truth for all bot-visible public message
history in the Glitter Boys Discord, then derive shared style and relationship
context from that corpus for Birmel, Scout, and the Glitter site.

The trusted seed archive at `~/Downloads/glitter-boys.zip` is canonical for the
history it contains. Discord fetch correctness is the first priority: a run
must prove completeness for its declared scope and fail loudly when it cannot.

## Delivery

Use two implementation pull requests in one git-spice stack:

1. Discord corpus source of truth, storage, workflows, infrastructure, and
   controlled backfill.
2. Shared context package, consumer migrations, relationship history, and
   weekly derived-data pull requests.

The second pull request depends on the first. No further splitting is planned
unless an independently discovered safety constraint makes it necessary.

## Locked decisions

### Corpus scope and fidelity

- Import the trusted seed without reinterpreting message contents. Acceptance is
  exactly 76,762 unique message IDs.
- Discover and archive every bot-visible public guild channel, public thread,
  and forum thread. Exclude direct messages and private threads.
- Maintain an explicit denylist for public channels that should not be archived.
- Inventory Discord scope before scraping. Persist channel and thread metadata,
  permissions outcome, archive state, and discovery timestamps.
- Treat the raw message ledger as append-only evidence. Never silently discard
  a previously observed message.
- Build a deterministic current projection keyed by Discord message ID. The
  observation with the newest `edited_timestamp` wins.
- Retain messages observed before deletion. Discord messages deleted before the
  first successful observation are outside the attainable contract and must be
  reported as such.
- Store attachment metadata in the corpus. Attachment bodies are not part of
  the first version; targeted image backfill can be added later.

### Completeness contract

- Paginate backward from the newest message until Discord returns an empty page.
- Freeze the newest message ID observed by the backward pass, then
  independently paginate forward from the oldest observed boundary until that
  frozen upper bound is reached. Ignore messages created after the frozen bound
  for that proof; they are captured by the next overlap.
- Record every request boundary, response count, first and last message ID,
  checksum, retry, and terminal empty-page or frozen-upper-bound proof.
- Reconcile all unique message IDs against the projection and reject duplicates,
  holes, malformed records, or inconsistent channel attribution.
- A channel is complete only when both traversal proofs and the projection
  reconciliation pass. A guild snapshot is complete only when every in-scope
  channel and thread is complete.
- Authentication or permission failures are fatal. Rate limits are retried from
  Discord's response metadata and remain visible in the run manifest.

### Fetch safety

- Use a dedicated archival bot with only View Channel and Read Message History
  permissions plus Message Content intent.
- Enforce a global one-request-per-second ceiling even when Discord permits
  more. Honor stricter Discord headers and `retry_after`.
- Use a durable Temporal workflow so the six-to-ten-year initial scrape can
  pause, retry, and resume without losing its cursor or duplicating evidence.
- Run one channel at a time for the initial backfill. A manual inventory review
  gates the full scrape.
- Run the steady-state REST capture daily with a seven-day overlap, resetting
  every channel with a complete historical traversal after six overlaps. Do not
  use a Gateway capture path in the first version.

### Storage and recovery

- Use the private `glitter-discord-corpus` SeaweedFS bucket as the sole
  canonical store.
- Write immutable raw pages and manifests with content hashes and verify every
  object immediately after writing it.
- Advance the canonical snapshot pointer only after SeaweedFS contains the exact
  verified snapshot checksum.
- Keep deterministic current projections and per-channel manifests versioned by
  snapshot. A projection can always be rebuilt from raw observations.
- Alert on storage-integrity failure, stalled progress, completeness failure,
  unexpected scope changes, and rate-limit pressure.

### Shared context

- Add `@shepherdjerred/glitter-context` as the language-neutral canonical
  package for people, style cards, relationship events, current relationships,
  and generation state.
- Store shared data as JSON with JSON Schema. Validate it with Zod for
  TypeScript consumers and Pydantic for Python consumers.
- Bundle browser- and Node-safe TypeScript exports; do not read package data
  from `node:fs` at runtime.
- Represent relationships as dated events plus a deterministic current
  projection. Caitlyn and Richard have a historical Dating event followed by a
  current Exes event.
- Migrate Birmel, Scout, and the Glitter relationship site to the package and
  delete their duplicate sources.

### Derived-data automation

- Run a weekly Temporal workflow that opens one human-reviewed pull request for
  meaningful style-card and relationship changes.
- Refresh a person's style card after at least 20 newly captured messages and at
  least quarterly even when the threshold is not met.
- Use GPT-5.6 Sol through the shared traced LLM helpers. Validate all generated JSON
  and reject incomplete or schema-invalid output.
- Permit the model to propose relationship event changes in the pull request,
  with corpus evidence. It must not mutate canonical relationship data outside
  a reviewable Git diff.
- Keep short raw message samples in style cards, selected only from explicitly
  safe candidates.
- Extend the existing bot-clone rehearsal so generated changes are path-scoped,
  deterministic, and idempotent.

## Implementation phases

### Pull request 1: accurate Discord corpus

1. Add schemas for inventory, raw observations, request pages, channel
   completeness manifests, projections, storage receipts, and guild snapshots.
2. Add a streaming seed importer and prove the trusted archive imports exactly
   once per message ID.
3. Add Discord inventory and conservative pagination clients with durable
   cursors, checksums, rate-limit telemetry, and fail-fast permission handling.
4. Add checksum-verified SeaweedFS persistence and conditional snapshot
   publication.
5. Add Temporal inventory, backfill, verification, and daily overlap workflows
   on a dedicated task queue.
6. Add SeaweedFS infrastructure, secret wiring, metrics, dashboards, alerts,
   operational documentation, and disaster-recovery rehearsal.
7. Run unit, property, fixture, workflow-replay, package, repository, and
   controlled live acceptance tests.

### Pull request 2: shared context and weekly refresh

1. Add the language-neutral shared package and migrate the current canonical
   data, including relationship history.
2. Rewire Birmel, Scout, and Glitter consumers; delete duplicates and update
   change-detection/build routing.
3. Add deterministic style-card and relationship proposal generation from
   complete corpus snapshots.
4. Add the weekly Temporal pull-request workflow, rehearsal, provenance,
   thresholds, and observability.
5. Run consumer, generation, workflow-replay, site, package, repository, and
   live dry-run acceptance tests.

## Acceptance

- The seed imports as exactly 76,762 unique messages with stable checksums.
- Every approved public channel and public thread has a successful backward
  proof, forward proof, projection reconciliation, and verified snapshot.
- Rerunning any import, page, projection, or workflow is idempotent.
- Adding, editing, and deleting messages produces the specified deterministic
  current projection without losing raw evidence.
- The daily overlap run discovers edits and new messages without missing any
  observable message in its contract.
- SeaweedFS recovery verification rebuilds the same projection and checksums.
- Birmel, Scout, and Glitter consume one validated context source with no
  duplicate canonical files.
- Caitlyn and Richard project to Exes while their prior Dating history remains
  queryable.
- Weekly generation opens at most one scoped, reviewable pull request and makes
  no commit when derived data is unchanged.

## Remaining

- [x] Implement, verify, and publish both draft pull requests.
- [x] Reconcile and land the shared-context/weekly-refresh implementation.
- [x] Verify the merged tree keeps the corpus consumers, paused schedule,
      recovery gates, and secret references coherent.
- [x] Review the Discord inventory and explicitly approve its public
      channel/thread scope before starting the full-history scrape.
- [x] Complete live Discord/SeaweedFS corpus acceptance and hand the separate
      OpenAI quota-gated weekly-refresh acceptance to
      `todos/glitter-corpus-worker-credentials.md`.
