---
id: plan-2026-07-26-glitter-discord-source-of-truth
type: plan
status: in-progress
board: true
verification: agent
disposition: active
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
- Independently paginate forward from the oldest observed boundary until
  Discord returns an empty page.
- Record every request boundary, response count, first and last message ID,
  checksum, retry, and terminal empty-page proof.
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
- Run the steady-state REST capture daily with a seven-day overlap. Do not use a
  Gateway capture path in the first version.

### Storage and recovery

- Create private SeaweedFS and Cloudflare R2 buckets.
- Write immutable raw pages and manifests to both stores using content hashes.
- Advance the canonical snapshot pointer only after both stores contain the same
  verified snapshot.
- Keep deterministic current projections and per-channel manifests versioned by
  snapshot. A projection can always be rebuilt from raw observations.
- Alert on mirror divergence, stalled progress, completeness failure, unexpected
  scope changes, and rate-limit pressure.

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
- Use GPT-5.5 through the shared traced LLM helpers. Validate all generated JSON
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
   completeness manifests, projections, mirror receipts, and guild snapshots.
2. Add a streaming seed importer and prove the trusted archive imports exactly
   once per message ID.
3. Add Discord inventory and conservative pagination clients with durable
   cursors, checksums, rate-limit telemetry, and fail-fast permission handling.
4. Add dual-store persistence and two-phase snapshot publication.
5. Add Temporal inventory, backfill, verification, and daily overlap workflows
   on a dedicated task queue.
6. Add SeaweedFS/R2 infrastructure, secret wiring, metrics, dashboards, alerts,
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
  proof, forward proof, projection reconciliation, and mirrored snapshot.
- Rerunning any import, page, projection, or workflow is idempotent.
- Adding, editing, and deleting messages produces the specified deterministic
  current projection without losing raw evidence.
- The daily overlap run discovers edits and new messages without missing any
  observable message in its contract.
- SeaweedFS/R2 restore rehearsal rebuilds the same projection and checksums.
- Birmel, Scout, and Glitter consume one validated context source with no
  duplicate canonical files.
- Caitlyn and Richard project to Exes while their prior Dating history remains
  queryable.
- Weekly generation opens at most one scoped, reviewable pull request and makes
  no commit when derived data is unchanged.

## Remaining

- [ ] Implement, verify, and publish both pull requests.
- [ ] Provision credentials and run controlled Discord, Temporal, SeaweedFS, R2,
      and pull-request acceptance tests.

## Session Log — 2026-07-26

### Done

- Consolidated the approved accuracy, safety, storage, relationship-history,
  automation, and two-pull-request decisions into this durable plan.
- Implemented the first pull-request layer: trusted-seed import, Discord scope
  inventory, conservative REST capture, two-direction completeness proofs,
  deterministic projections, dual SeaweedFS/R2 storage, recovery, Temporal
  workflows and schedule, operator commands, infrastructure, observability,
  alerts, dashboard panels, and the operations guide.
- Imported `~/Downloads/glitter-boys.zip` twice in independent directories and
  confirmed byte-identical outputs: 76,762 unique messages, zero duplicate IDs,
  archive SHA-256
  `19aaca11be85b99d8034e48cfaf45e50e9739e9760da116d7262a6fd7588cc92`,
  and projection SHA-256
  `8bad3bee568dfb5eb60d6524eee6b3c75d6ea3b1ac8f545887bac60cc8db572f`.
- Passed the affected repository verification surface, including 656 Temporal
  tests, plus focused cdk8s, Terraform/OpenTofu, documentation, and dashboard
  query tests. The explicit 1Password contract check correctly remains red
  until the seven new Discord/R2 fields are populated and its hashed snapshot
  is refreshed.

### Remaining

- Commit and publish the corpus layer as the first draft pull request.
- Implement, verify, and publish the shared-context and weekly-refresh pull
  request on top.
- Populate the Temporal worker's seven Discord/R2 fields in 1Password, refresh
  the non-secret vault snapshot, then run inventory and obtain explicit scope
  approval before any full-history Discord request.
- Run the controlled Discord canary, mirrored seed publication, Temporal,
  SeaweedFS, R2, recovery, and pull-request acceptance tests.

### Caveats

- The seed is trusted only for the history it contains; Discord is required for
  all other public channels, public threads, and future observations.
- A Discord message deleted before any successful observation cannot be
  recovered through the REST history API.
- The daily REST overlap re-observes at least seven days and proves continuity
  past the previous newest message ID. An edit older than the overlap is not
  observable until a deliberate historical rescan; raw observations already
  captured are never removed.
- Local `op` is not signed in, and no Discord/R2 credentials have been supplied
  in this session. The schedule is created paused and the full backfill is
  inventory-approval-gated, so this cannot accidentally start scraping.
