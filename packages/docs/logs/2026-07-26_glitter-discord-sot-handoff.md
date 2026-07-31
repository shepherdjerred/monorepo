---
id: log-2026-07-26-glitter-discord-sot-handoff
type: log
status: complete
board: false
---

# Glitter Discord Source of Truth Handoff

> Historical handoff completed on 2026-07-29. The implementation, seed,
> backfill, recovery verification, and daily schedule are now live. Current
> production status and the remaining OpenAI quota-gated weekly acceptance are
> tracked in
> `packages/docs/plans/2026-07-27_glitter-corpus-live-rollout.md`.

## Executive summary

The implementation exists as a two-PR git-spice stack:

1. [PR #1693](https://github.com/shepherdjerred/monorepo/pull/1693) builds the
   loss-intolerant Discord corpus, trusted-seed importer, mirrored storage,
   Temporal workflows, recovery verification, infrastructure, observability,
   and operator tooling.
2. [PR #1700](https://github.com/shepherdjerred/monorepo/pull/1700) adds the
   language-neutral shared context package, migrates Birmel/Scout/Glitter, adds
   relationship history, and creates the weekly derived-data PR workflow.

Both PRs remain drafts. Do not merge either one from this handoff. The code and
local verification are substantially complete, but live credential projection,
Discord inventory approval, and controlled end-to-end acceptance remain.

The highest priority is exact corpus correctness. A run must never claim
completeness when it may have missed an observable message. The trusted seed is
canonical for its included history. All Discord-fetched data must retain raw
evidence, prove traversal completeness, and fail loudly on permission,
pagination, identity, or mirror discrepancies.

## Non-negotiable safety contract

- Archive every bot-visible public guild channel, public thread, and forum
  thread approved by inventory. Exclude direct messages and private threads.
- Inventory the guild before scraping and obtain explicit human approval of the
  immutable inventory checksum.
- Do not begin the full six-to-ten-year scrape from an unreviewed inventory.
- Run Discord REST requests sequentially with a global one-request-per-second
  ceiling. Honor stricter Discord reset headers and `retry_after`.
- Prove each channel with independent backward and forward traversals over a
  frozen upper bound. The unique message-ID sets must match.
- Preserve every raw page and manifest immutably in both SeaweedFS and
  Cloudflare R2. Advance `latest.json` only after both stores agree.
- Never remove a previously observed message from the canonical projection.
  A message observed before deletion remains present.
- A Discord message deleted before any successful observation cannot be
  recovered through the REST API. Do not claim otherwise.
- The steady-state schedule starts paused. Inventory, canary, and the first
  complete mirrored snapshot require operator control.

## Workspace and stack state

All implementation work is in:

```text
/Users/jerred/git/monorepo/.claude/worktrees/glitter-discord-sot
```

The main checkout was clean before this handoff document was added. The
implementation worktree was also clean at handoff time.

| Surface                       | State at handoff                             |
| ----------------------------- | -------------------------------------------- |
| Current implementation branch | `feature/glitter-discord-sot`                |
| Local PR 1 head               | `e218f187653a0318c9f4cfa34e4d2f8c6c298322`   |
| PR 1 remote head              | `1db74fc5e66d66879f445cea8e66ed450e490dd7`   |
| Current `origin/main`         | `071cb795e164b29d7526401626f9bccd820085b6`   |
| PR 2 branch ref               | `c2f9951c884768c35a28674a220fb14bb866082c`   |
| Reviewed PR 2 safety ref      | `refs/codex/glitter-shared-context-reviewed` |
| Reviewed PR 2 commit          | `1c32572d5c5dde33f18b4aa639e10fb42a9b48f6`   |
| Secret-wiring safety ref      | `refs/codex/glitter-corpus-secret-wiring`    |
| Secret-wiring object          | `0d73047bee7974a160d67c7c4b6e107841467daf`   |

PR 1 was restacked successfully onto `071cb795e` after its last clean commit
gate. Its local commits are:

```text
e218f1876 fix(temporal): harden Glitter corpus guarantees
729f5aad8 fix(root): prevent quality ratchet subprocess deadlock
443fee610 feat(temporal): add verified Glitter Discord corpus
```

PR 1 has not been pushed after this restack.

### Concurrent-worktree hazard

`feature/glitter-shared-context` is currently checked out in a separate
worktree:

```text
/Users/jerred/git/monorepo/.claude/worktrees/pr-1700-glitter-context
```

That worktree reset the branch from reviewed commit `1c32572d5` back to remote
head `c2f9951c8` at 2026-07-26 20:51 PT. Do not delete, reset, detach, or modify
that worktree without first establishing who owns it and whether it is still
active.

The reviewed PR 2 commit is protected by
`refs/codex/glitter-shared-context-reviewed`. Do not use the current PR 2 branch
ref as the source of truth for the completed review fixes. Once the other
worktree is released, restore the reviewed diff from the safety ref and restack
the PR through git-spice onto PR 1. Do not use a raw `git rebase`, and do not
force-reset a branch that is checked out elsewhere.

One safe restoration approach after the other worktree is released is:

1. Save the reviewed delta with
   `git diff c2f9951c8 refs/codex/glitter-shared-context-reviewed`.
2. Switch to the PR 2 branch using git-spice.
3. Restack that branch onto the new PR 1 head using git-spice.
4. Apply the saved reviewed delta, inspect every changed path, run the PR 2
   focused gates, and amend through git-spice.
5. Confirm PR 1 is an ancestor of PR 2 before submitting the stack.

## PR 1: accurate Discord corpus

PR 1 implements:

- strict Zod schemas for guild inventory, raw observations, page proofs,
  channel states, snapshots, mirror receipts, and latest pointers;
- deterministic current-message projection and stable checksums;
- trusted ZIP/CSV seed import with per-channel observation partitions;
- Discord guild/channel/thread inventory with permission and Message Content
  intent validation;
- conservative REST pagination with durable Temporal child workflows;
- a persisted global request lease, cancellation-aware rate-limit waits, and
  progress heartbeats;
- content-addressed immutable raw pages and request journals that reuse the
  first successful Discord response after a partial storage failure;
- independent backward and forward traversal proofs over a frozen newest
  message boundary;
- daily seven-day overlap capture that must cross the prior newest message ID;
- a complete historical refresh after six overlap states;
- immutable dual writes to SeaweedFS and R2 with read-back verification;
- conditional, monotonic publication of the mirrored latest pointer;
- graph recovery verification before publication;
- recovery and metric restoration after worker restart;
- private SeaweedFS and R2 buckets in OpenTofu;
- operator CLI commands, Grafana panels, Prometheus alerts, and an operations
  runbook.

### Final PR 1 hardening pass

The most recent local commit additionally fixes the current-head review gaps:

- Complete refreshes merge the last checksum-verified projection. Messages
  captured before later deletion therefore survive the six-overlap reset.
- Complete-state manifests record the retained baseline manifest.
- Recovery verifies the retained immutable projection directly. This preserves
  deleted rows without creating an unbounded recursive recovery chain.
- Both backward and forward observations participate in current-version
  selection during capture and recovery. A newer edit seen by the forward pass
  cannot be discarded.
- Duplicate-observation accounting is calculated from the newly observed
  ledger rather than from the baseline-expanded projection.
- The operational seed importer pins the approved archive checksum, projection
  checksum, 164 CSV files, 76,762 observations, 76,762 unique messages, and
  zero duplicates before writing local output or mirroring objects.
- A synthetically valid or modified archive is rejected by the operational
  path.
- An explicitly present blank
  `GLITTER_DISCORD_DENYLIST_CHANNEL_IDS` is valid. A missing variable still
  pauses configuration.
- The periodic-full-refresh workflow passes the prior manifest explicitly.
- Proof test fixtures now include required `lineageDepth` and `seedPrefix`
  fields.

Important files:

- `packages/temporal/src/activities/glitter-corpus.ts`
- `packages/temporal/src/activities/glitter-corpus-verification.ts`
- `packages/temporal/src/activities/glitter-corpus-recovery.ts`
- `packages/temporal/src/activities/glitter-corpus-seed.ts`
- `packages/temporal/src/workflows/glitter-corpus.ts`
- `packages/temporal/src/shared/glitter-corpus.ts`
- `packages/docs/guides/2026-07-26_glitter-discord-corpus-operations.md`
- `packages/docs/archive/completed/2026-07-26_glitter-discord-source-of-truth.md`

## PR 2: shared context and weekly refresh

The reviewed PR 2 commit adds
`@shepherdjerred/glitter-context` as the canonical language-neutral package:

- JSON source data and JSON Schema;
- Zod validation for TypeScript;
- Pydantic validation for Python;
- browser- and Node-safe built exports with inlined JSON;
- 71 people, 80 relationship events, and 13 style cards;
- dated relationship history plus deterministic current projection;
- Caitlyn/Richard historical Dating followed by current Exes;
- Birmel, Scout, and Glitter migrations with duplicate sources removed;
- weekly GPT-5.5 style-card and relationship proposal generation;
- complete-snapshot provenance, deterministic sampling, evidence requirements,
  thresholds, idempotence, and a single human-reviewed PR;
- paused Temporal schedule, dedicated queue, observability, and rehearsal.

The final reviewed amend at `1c32572d5` also:

- derives Birmel election persona Discord IDs from canonical people data;
- filters candidates to personas with exactly one canonical Discord ID;
- honors directed relationship endpoint order;
- ensures Birmel and Glitter build the shared producer first in clean
  checkouts;
- routes shared-context changes to Birmel, Scout, Glitter, Temporal, and image
  build surfaces;
- mirrors canonical identifier, Discord snowflake, checksum, date, and duplicate
  Discord-ID constraints in Pydantic;
- adds generation-state entries for newly refreshable people;
- generates valid TypeScript for kebab-case and digit-leading person IDs;
- rejects duplicate Discord IDs in the TypeScript schema;
- adds focused TypeScript, Python, Temporal, Birmel, generator, deployment, and
  CI-selector tests.

## Trusted seed evidence

`~/Downloads/glitter-boys.zip` was imported repeatedly without mirroring. The
real archive passed the new operational pins:

| Property           | Verified value                                                     |
| ------------------ | ------------------------------------------------------------------ |
| Archive SHA-256    | `19aaca11be85b99d8034e48cfaf45e50e9739e9760da116d7262a6fd7588cc92` |
| Projection SHA-256 | `8bad3bee568dfb5eb60d6524eee6b3c75d6ea3b1ac8f545887bac60cc8db572f` |
| CSV files          | 164                                                                |
| Observations       | 76,762                                                             |
| Unique messages    | 76,762                                                             |
| Duplicate IDs      | 0                                                                  |
| First timestamp    | `2016-08-03T07:15:58.632Z`                                         |
| Last timestamp     | `2025-11-23T03:01:23.939Z`                                         |
| Guild slugs        | `glitter-boys`, `league-of-legends`                                |
| Channels           | 98                                                                 |
| Authors            | 125                                                                |

The last verification output is under
`/tmp/glitter-seed-verify.NCL1r2`. It is disposable and was never mirrored.

## Verification evidence

### PR 1

- Real trusted-seed operational import: passed.
- Focused corpus/workflow/schedule suite: 72 tests, 183 expectations, zero
  failures.
- Complete Temporal test task: passed.
- Temporal typecheck: passed.
- Temporal lint: passed with warning-only existing duplicate-code reports.
- Markdown lint, Prettier, and docs model check: passed.
- Final commit hook after the hardening pass: 34/34 affected tasks passed,
  including `check:1password`, recovery rehearsal, docs, and repository safety
  gates.
- PR 1 was then restacked cleanly onto current `origin/main`; no content
  conflicts occurred.

### PR 2

- Shared package: five Bun tests passed.
- Canonical Python validation: 71 people, 80 relationships, 13 style cards.
- Python constraint suite: three tests passed.
- Temporal focused suite: ten tests passed.
- Birmel focused suite: eight tests and 80 expectations passed.
- CI image selector: 36 tests and 67 expectations passed.
- CI changed-surface selector and pipeline validator passed.
- Dependency-aware Glitter build passed.
- Birmel typecheck and lint passed.
- Glitter-context and Temporal typecheck/lint passed.
- Final commit hook for reviewed amend `1c32572d5`: 89/89 affected tasks
  passed.

### Stale remote CI

The latest remote builds are for old heads and are not authoritative for the
local reviewed state:

- Buildkite #6445 failed at PR 1 head `1db74fc5e`. All
  functional/mechanical jobs passed; the aggregate failed on current-head
  automated review findings that the local hardening addresses.
- Buildkite #6446 failed at PR 2 head `c2f9951c8`. All
  functional/mechanical jobs passed; the aggregate failed on review findings
  addressed by reviewed safety commit `1c32572d5`.

Do not report those builds as evidence about `e218f1876` or `1c32572d5`.
Republish exact reviewed heads and wait for new Buildkite builds.

## Credential projection blocker

The local 1Password CLI has the correct account configured but is not signed
in:

```text
my.1password.com
shepherdjerred@gmail.com
```

The existing Temporal worker item is:

```text
mjgnqqh37jxyzseqrddde2jgaq
```

Six new populated fields are required:

- `GLITTER_DISCORD_TOKEN`
- `GLITTER_DISCORD_GUILD_ID`
- `GLITTER_DISCORD_GUILD_SLUG`
- `GLITTER_CORPUS_R2_ENDPOINT`
- `GLITTER_CORPUS_R2_ACCESS_KEY_ID`
- `GLITTER_CORPUS_R2_SECRET_ACCESS_KEY`

SeaweedFS reuses the worker's existing `S3_ENDPOINT`,
`AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`. Both corpus bucket names and
regions are non-secret literal deployment values.

Do not put an empty denylist field in 1Password. The 1Password operator omits
blank fields. Project
`GLITTER_DISCORD_DENYLIST_CHANNEL_IDS=`
as an explicit non-secret `EnvValue.fromValue("")` unless the approved
inventory process identifies public channels that must be excluded.

The uncommitted cdk8s wiring is recoverable from
`refs/codex/glitter-corpus-secret-wiring`:

```bash
git show \
  refs/codex/glitter-corpus-secret-wiring^3:packages/homelab/src/cdk8s/src/resources/temporal/glitter-corpus-env.ts

git diff \
  refs/codex/glitter-corpus-secret-wiring^1 \
  refs/codex/glitter-corpus-secret-wiring \
  -- packages/homelab/src/cdk8s/src/resources/temporal/worker.ts
```

Adapt that preserved module so the denylist is a literal empty value instead
of a secret reference. Add the six populated fields to the real 1Password item,
refresh `packages/homelab/src/cdk8s/onepassword-vault-snapshot.json` with the
repository script, and run `check:1password` before committing. The committed
snapshot contains only hashes of item/field structure, not secret values.

Do not land secret references before the real fields and refreshed snapshot
exist; the offline contract check and the ExternalSecret runtime behavior are
deliberately fail-fast.

## Credential setup checklist

Do not paste credentials into chat. Populate them directly in 1Password.

### Discord

- [ ] Create a dedicated Discord application and bot named
      `Glitter Corpus Archiver`.
- [ ] Enable the privileged **Message Content Intent**.
- [ ] Install the bot in Glitter Boys with only **View Channels** and
      **Read Message History**.
- [ ] Do not grant the bot access to private channels or private threads.
- [ ] Enable Discord Developer Mode and copy the Glitter Boys server ID.
- [ ] Add these populated fields to the existing Temporal worker 1Password item
      `mjgnqqh37jxyzseqrddde2jgaq`:
  - `GLITTER_DISCORD_TOKEN`
  - `GLITTER_DISCORD_GUILD_ID`
  - `GLITTER_DISCORD_GUILD_SLUG` with value `glitter-boys`

### Cloudflare R2

- [ ] Ensure the private `glitter-discord-corpus` R2 bucket exists through the
      pull request 1 OpenTofu resource.
- [ ] Create an R2 **Object Read & Write** token restricted only to that bucket.
- [ ] Add these populated fields to the same Temporal worker 1Password item:
  - `GLITTER_CORPUS_R2_ENDPOINT`
  - `GLITTER_CORPUS_R2_ACCESS_KEY_ID`
  - `GLITTER_CORPUS_R2_SECRET_ACCESS_KEY`

Do not add a blank denylist field to 1Password. The 1Password operator omits
blank fields, so cdk8s must project
`GLITTER_DISCORD_DENYLIST_CHANNEL_IDS=""` as a non-secret literal. SeaweedFS
continues to use the Temporal worker item's existing `S3_ENDPOINT`,
`AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`.

### Agent hand-back

After the six fields above are populated:

- [ ] Refresh the committed non-secret 1Password vault snapshot.
- [ ] Run the offline 1Password contract check.
- [ ] Finish and verify the cdk8s environment projection.
- [ ] Deploy the worker, leaving the recurring schedule paused.
- [ ] Run Discord inventory only.
- [ ] Present the complete inventory and checksum for explicit human approval.
- [ ] Run one bounded canary only after inventory approval.
- [ ] Start no full-history scrape without a second explicit approval after the
      canary evidence is reviewed.

## Safe continuation sequence

1. Work only in the Glitter implementation worktree. Preserve the main-checkout
   handoff document until it has been intentionally moved into the feature
   worktree or separately published.
2. Confirm no process is mutating either Glitter branch.
3. Submit only the current PR 1 branch through git-spice. Its local reviewed
   head is `e218f1876`; the remote still points to `1db74fc5e`.
4. Resolve ownership of `pr-1700-glitter-context`. Do not remove or reset it
   while another process owns it.
5. Restore the PR 2 reviewed delta from
   `refs/codex/glitter-shared-context-reviewed`, restack it onto PR 1 through
   git-spice, and rerun its focused gates.
6. Sign in to 1Password, add the six real fields, apply the preserved cdk8s
   projection with the non-secret blank denylist, and refresh the vault
   snapshot.
7. Run affected repository verification and submit the two-PR stack with
   git-spice.
8. Verify exact remote head OIDs before requesting one fresh `@codex review` per
   PR. Do not spam review requests across intermediate heads.
9. Monitor Buildkite, current-head review threads, and direct merge-tree
   conflicts until both draft PRs are clean. Do not merge.
10. With credentials available, run Discord inventory only.
11. Present the full inventory and checksum for explicit human approval.
12. After approval, run one bounded public-channel canary and verify traversal
    equality plus both mirror receipts.
13. Mirror the already verified trusted seed.
14. Start the full historical backfill only after the user explicitly approves
    the inventory and canary evidence.
15. Verify the published snapshot graph and both storage mirrors before
    unpausing the daily schedule.
16. Run the weekly shared-context workflow as a dry run and verify that it
    creates at most one scoped review PR, or no commit when data is unchanged.

## Pull-request artifacts

- PR 1 dashboard preview:
  `https://public.sjer.red/pr/assets/1693/glitter-corpus-dashboard-preview.jpg`
- PR 2 shared-context preview:
  `https://public.sjer.red/pr/assets/1700/glitter-shared-context.png`

## Session Log — 2026-07-26

### Done

- Audited and recorded the exact local, remote, PR, Buildkite, worktree, and
  safety-ref state.
- Preserved the reviewed PR 2 amend at
  `refs/codex/glitter-shared-context-reviewed` after a concurrent worktree
  reset the branch.
- Restacked verified PR 1 onto current `origin/main`; the clean local head is
  `e218f1876`.
- Wrote this full cold-start handoff in the main checkout. No implementation
  files were changed in the main checkout.
- Added the manual Discord, Cloudflare R2, 1Password, and agent hand-back
  credential checklist to this handoff.

### Remaining

- [ ] Publish local PR 1 head `e218f1876`.
- [ ] Release or coordinate the separate PR 2 worktree, restore reviewed commit
      `1c32572d5`, and restack PR 2 through git-spice.
- [ ] Add the six real Discord/R2 fields to the Temporal worker 1Password item,
      apply cdk8s projection, and refresh the non-secret vault snapshot.
- [ ] Run fresh Buildkite and current-head automated reviews for both PRs.
- [ ] Run credentialed inventory, obtain explicit scope approval, run a bounded
      canary, mirror the seed, and only then start the full backfill.
- [ ] Run mirrored recovery and weekly-context end-to-end acceptance.

### Caveats

- The remote PR heads and Buildkite builds are stale relative to the reviewed
  local commits.
- A separate worktree currently owns the PR 2 branch and reset it once. Do not
  overwrite that worktree or discard its state.
- The local 1Password CLI is not signed in, and the six new secret fields have
  not been provisioned.
- No live Discord inventory, canary, seed mirror, full scrape, or schedule
  unpause has occurred.
- The trusted seed covers only its included export. Discord is still required
  for all other approved public channels, public threads, and future messages.
- Messages deleted before any successful observation remain unattainable.

## Session Log — 2026-07-29

### Done

- Closed this historical handoff after the implementation, production seed,
  full backfill, recovery verification, and daily schedule shipped.
- Updated the completed source-plan reference to its archived location.

### Remaining

- Follow the active rollout plan for the OpenAI quota-gated weekly-refresh
  acceptance.

### Caveats

- The commit IDs, worktrees, credentials, R2 design, and checklists above are a
  historical snapshot from 2026-07-26, not current operating instructions.
