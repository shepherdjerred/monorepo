# tasknotes-core

The shared Rust workspace for Facet clients: domain semantics, lossless vault
documents, durable standalone storage, and direct Obsidian Sync. Swift, Kotlin,
and C# hosts consume generated bindings behind their platform engine boundaries.

## Layout

```text
crates/tasknotes-core/      Pure core — no FFI, no I/O, no platform APIs
crates/tasknotes-vault/     Vault paths, settings, mappings, conditional Markdown edits
crates/tasknotes-runtime/   SQLite adapter, profiles, indexing, journal, outbox, conflicts
crates/obsidian-sync/       Reference-tested encryption, authentication, sans-I/O protocol
crates/tasknotes-core-ffi/  UniFFI scaffolding and nothing else
bindings/                   Committed, generated Swift, C#, and Kotlin bindings
tools/uniffi-bindgen-cs/    Pinned C# generator retarget for the UniFFI ABI
xtask/                      cargo xtask: bindings + XCFramework tooling
```

## Iron rules

1. **The core is pure and sans-I/O.** `crates/tasknotes-core` has no clock, no
   filesystem, no network. HTTP and storage arrive as host-implemented traits.
2. **`bindings/` is committed on purpose.** UniFFI `Record` field order is the
   ABI; reordering two same-typed fields leaves every API checksum and the C
   header byte-identical. `cargo xtask check-bindings` (regenerate + `git diff
--exit-code`) is the only mechanical guard against that silent
   data-corruption class. Never regenerate without committing the diff. See
   [bindings/README.md](bindings/README.md).
3. **[`@tasknotes/fixtures`](../tasknotes-fixtures) is the oracle, not test
   data.** The same JSON scenarios and recurrence corpus are executed by both
   the TypeScript and Rust implementations
   (`crates/tasknotes-core/tests/sync.rs`, `recurrence_corpus.rs`); that is
   what keeps them from drifting. A fixture that disagrees with an
   implementation is a finding, never a file to edit.

## Commands

The package-local `rust-toolchain.toml` keeps Cargo on the expected compiler
under Turbo's strict environment. Keep its version synchronized with the
repository's `.mise.toml` Rust pin.

The package is a Turbo shim over cargo, so it participates in the workspace
task graph. Directly or via `bunx turbo run <task> --filter=tasknotes-core`:

```bash
bun run build       # cargo build --workspace --all-targets
bun run test        # pinned upstream-default check + cargo test --workspace
bun run typecheck   # cargo check --workspace --all-targets --all-features
bun run lint        # fmt + clippy -D warnings + no-suppressions + check-bindings + cargo deny
bun run bindings    # cargo xtask generate-bindings
bun run generate    # same three-language producer, included in root Turbo generate
```

xtask directly (the `xtask` alias is defined in `.cargo/config.toml`):

```bash
cargo xtask generate-bindings   # regenerate Swift, C#, and Kotlin together
cargo xtask check-bindings      # regenerate + git diff --exit-code
cargo xtask build-xcframework   # build artifacts/TaskNotesCoreFFI.xcframework
cargo xtask verify-swift        # compile and run Swift against the artifacts
```

`generate-bindings` and `check-bindings` need only cargo; the XCFramework
targets require a macOS host with Xcode.

`check-xcframework` compares the artifact's recorded source manifest with current
Rust sources, lockfile, generated Swift/header bytes, and shared schemas. A
semantic change invalidates old libraries even when UniFFI checksums are equal.
Every internal native Cargo build uses the committed lockfile.

## Vault API

`TaskDocument::parse` validates UTF-8 Markdown and mapping frontmatter. Its
`plan` method returns replacement bytes plus SHA-256 revisions. Unknown keys,
comments, body text, BOMs, and line endings remain in the document; a semantic
check rejects edits that change properties outside the requested plan.
Body replacement is explicit. Invalid YAML, duplicate keys, unsafe logical
paths, and duplicate property edits return typed errors.

Writes are plans, not filesystem mutations. A host must journal the plan,
compare freshly read bytes with `expected_revision`, and atomically replace
the target while holding its writer coordination mechanism. The hash check
alone does not prevent a race between checking and replacing a local file.
Folder adapters also enforce platform filename and symlink boundaries.

`TaskNotesConfiguration::resolve` overlays providers at top-level section
boundaries: explicitly approved standard settings, portable `tasknotes.yaml`,
then `.obsidian/plugins/tasknotes/data.json`. A higher section replaces the
lower section; missing nested keys receive schema defaults rather than values
from the discarded lower section. `effective` retains normalized policies.
A present invalid selected provider fails; it never silently falls through.
The immutable development oracle is `@tasknotes/model@0.3.0-rc.9`; its captured
defaults remain byte-identical in `ci/reference/vault-defaults.json`.
`ci/vault-reference.ts` checks that complete development capture against the pinned
model, then checks production defaults with exactly three retired timing mappings
and the `timeTracking` section removed. Every retained default remains guarded.
Production configuration
uses the pinned official [TaskNotes 4.13.8 settings defaults](https://raw.githubusercontent.com/callumalpass/tasknotes/4.13.8/src/settings/defaults.ts)
and specification for supported task features, including filename titles.
Those differ from the development model's captured baseline. Missing provider sections and nested keys receive the production
baseline; explicit opposite values are honored. Present malformed recognized
plugin settings fail with typed configuration errors before compatibility
mapping can drop them. Apps do not execute the development oracle.

Plugin settings support custom field names, status values and cycle rules,
priority values, task identification, title storage, and creation status and
priority. Portable YAML supports `mapping`, `status`, `defaults`, detection
`method` or ordered unique `methods: [tag, property]`, `combine: and|or`, string
or array folder exclusions, and `title.storage`. Loading, creation and strict
merged writes share the same effective detection policy, including mapped tag
fields. Unsupported field-presence/match extensions fail explicitly. This API
does not yet claim full TaskNotes specification conformance.

Native hosts access `FfiVaultDocument`, `FfiVaultConfiguration`, and
`VaultDocumentWrite` through their host boundary. JSON properties and edits
carry configurable and unknown fields without introducing a second native
schema. These exports do not start a local HTTP server.

## Standalone runtime

`tasknotes-runtime::engine::Engine` owns app-private SQLite state using WAL and
full durability. `FfiFacetEngine` is its native boundary. Its JSON contract is
declared in `@tasknotes/fixtures/schema/facet-engine.schema.json`; shared positive
and negative cases live in `vault/facet-contract.json`. Native boundaries validate
schema version 1 and use open status/priority strings. Snapshot `version` is the
durable state sequence, distinct from `schemaVersion`.

Task writes canonicalize explicitly written created/modified timestamps to
offset-qualified UTC `Z` at whole seconds, truncating fractions. Completion
dates require calendar dates; due/scheduled preserve date or instant granularity.
Creation applies this after template/default precedence. Unwritten temporal
roles, unknown properties and body bytes remain intact. The original mutation
clock and execution timezone remain part of request identity and day resolution;
equivalent writes leave dateModified unchanged when persisted state is unchanged.

Explicit reminder writes canonicalize absolute entries' `absoluteTime` to UTC
whole seconds after template/default precedence. Relative offset strings and all
other reminder values retain their precision and order. Explicit normalization applies
the same rule; unrelated updates and edits leave historical reminder timestamps
unchanged. Invalid explicitly written absolute times fail before file effects.
Create and Update resolve command property aliases before creation or completion
transition planning.
Temporal
canonicalization of template and persisted document keys uses configured
physical mappings and exact canonical roles, preserving unconfigured snake-case
vendor values. Explicit normalization retains its separate legacy alias policy;
conflicting ignored aliases are preserved rather than reinterpreted temporally.
Explicit normalization also applies these write rules even when alias spelling
already matches; an already canonical document remains byte-identical.

Creation and successful recurring-instance completion insert a missing inline
`DTSTART` before RRULE parameters, choosing scheduled before dateCreated. A
date seed stays date-only; an instant seed becomes a whole-second UTC datetime.
A valid existing DTSTART remains unchanged unless completion-anchor progression
explicitly advances it. Invalid present seeds and DTSTART values fail before file
effects; seed resolution reports `missing_recurrence_seed` when its selected
seed is absent or invalid, with no fallback past an invalid preferred seed.
Create also validates explicit temporal-role inputs before template/default
planning; errors detected at that earlier boundary remain temporal input errors.
Read-only
legacy recurrence compatibility remains separate from these writes.

Recurring completion accepts an explicit date or offset-qualified datetime through
SetCompletion, ToggleComplete, SetStatus, and EditTask. Datetimes select the target
instant's calendar day in the supplied execution timezone; completion anchors use
that instant as whole-second UTC DTSTART. Scheduled anchors retain their seed.
Repeated completion of an already completed day remains a byte-identical no-op;
uncompletion retains the advanced anchor, while Undo restores the original bytes.
Absent targets now choose scheduled, due, then the immutable mutation civil day.
Stored datetime fallback values contribute their literal written day and do not
become explicit instant anchors. Corrupt preferred fallback values fail before
effects. Explicit datetimes require executionContext; collection/system timezone
authority fallback is still unimplemented. Ordinary nonrecurring completion keeps
its existing mutation-day behavior. These changes do not establish full temporal
or profile conformance.
All four completion commands now validate supplied targets at the shared boundary,
including formerly ignored malformed strings on nonrecurring tasks. Valid unused
targets do not require timezone context for nonrecurring completion. Recognized
corrupt scheduled/due sources continue to fail in strict and permissive modes;
compatibility normalization and generic unusable-candidate continuation remain
an unresolved distinction from the normative fallback policy.

Profiles register a local-folder or private Sync capability without persisting
device paths or credentials. Host adapters retain folder rights and secure
storage. Direct Sync imports are rejected for external-folder profiles. A
profile cannot be removed while journals, uploads, or conflicts remain.

An empty private Sync replica exposes a waiting snapshot with null configuration
and an actionable problem. Raw remote files/settings can arrive in this state;
editing requires discovered settings or explicit approval of standard defaults.

The required `FacetVaultFiles` callback contract supplies logical enumeration,
immutable snapshots, exact reads of at most 1 MiB, and durable staged atomic
replacement/deletion with metadata for captured displaced versions. SHA-256
plus a lock is not compare-and-exchange against uncooperative
writers. Hosts retain captured versions until Rust acknowledges them after the
SQLite commit. Startup recovers pending journals and imports any unexpected
captured bytes into the conflict inbox. Host callbacks never hold the database
mutex; a separate coordinator serializes complete operations per profile.

Commands are idempotent by a caller-supplied mutation identity and timestamp.
Reuse with a different payload is rejected. The runtime journals bytes before
calling the host, then commits the index and immutable upload receipts. An
upload acknowledgement updates the common base without replacing newer local
edits. Overlapping remote edits preserve base/local/remote outside task indexing
and pause uploads for that path. Saved views are ordinary Markdown documents
under `Facet/Views`, with versioned `facetView` frontmatter.

Task creates and updates validate the resulting mapped document in strict mode
by default. Unknown fields survive unless `reject_unknown_fields` is explicitly
enabled. Historical duration estimates, work entries and Pomodoro counts, including
their configured physical keys, remain opaque preservation metadata even under
that policy. They are not task roles and receive no timing validation or completion
effects; unrelated unknown fields still fail closed. Ordinary edits that remove configured task detection fail visibly
before publication. Semantically unchanged updates keep original bytes and
`dateModified`. A raw patch that sets a completed status without its required
completion date is rejected; `set_status` performs that configured transition.
Recurring board moves accept optional
`occurrenceDate`, using the immutable mutation civil day when absent, and update
the instance rather than converting completion into a parent status rewrite.

For unmaterialized parent instances, `set_occurrence_skipped` accepts `path`, optional `expectedRevision`, a required
canonical `occurrenceDate` (`YYYY-MM-DD`), and required Boolean `skipped`.
Skipping removes that day from completed instances and adds it once to skipped
instances. Unskipping only removes skip membership. Neither operation advances
the recurrence rule/anchor, changes scheduled/due dates, or changes base status.
Valid days outside the generated recurrence window are accepted. Exact no-ops
preserve document bytes, content revision and `dateModified`; they still receive
the ordinary durable mutation receipt. Changed operations use the existing
journal, revision CAS, replay and Undo contract.

`materialize_occurrence` accepts `parentPath`, required `expectedParentRevision`,
canonical `occurrenceDate`, optional `expectedOccurrenceRevision`, per-occurrence
`properties`, and optional `body`. It creates or reuses one uniquely resolved
parent/date task and returns its authoritative `taskPath` in the durable receipt.
Existing children remain byte-identical. Caller fields cannot replace occurrence
identity or series policy. An occurrence template can supply child status and
scheduled values; otherwise normal creation defaults and the target day apply.
Inherited attachment references retain their original binary targets and order
across folders; no binary content is copied. Parent reads are recorded separately
from file writes (introduced in SQLite schema 13) and checked before publication, after file
exchanges, and on recovery. These checks and per-file CAS provide recoverability,
not a filesystem transaction against uncooperative external writers. This command
is available directly and in partial batches; atomic batches reject it before
effects. These APIs do not establish the materialized-occurrences profile or
native acceptance.

`materialize_occurrence_window` accepts `parentPath`, required
`expectedParentRevision`, and canonical immutable `referenceDate`. It explicitly
creates or reuses every generated civil day in the configured rolling window.
The parent must use effective `rolling` mode. Its mapped horizon overrides win
over `occurrences.past_horizon`/`future_horizon`; missing settings use `P0D` and
`P14D`. Nonnegative ISO durations use the existing reminder arithmetic (years
365 days, months 30 days); a partial day includes its outer civil day. Endpoints
are inclusive. Invalid durations, overflow, more than 100,000 days between
endpoints, more than 1,000 new children, or more than 1,000,000 walked periods and
candidate instants (including eager timeset products and positional preparation)
reject the entire action before file publication. Products use checked arithmetic
and consume the budget before allocation, even with COUNT=1. Expansion
does not truncate dates or reset COUNT at the window start; sub-daily candidates
deduplicate to one child per civil day.

Its optional operation-specific `origin` is `user` or `automatic_maintenance`.
Omission retains user semantics and its original serialized request identity;
present null, other values and origins on other command kinds fail decoding.
Automatic windows use the same journals, provider fences, recovery and receipts,
but are excluded from the core's user Undo selection. Explicit Generate window
actions retain ordinary group Undo ownership of their newly created children.
Hosts never filter or reorder the core's Undo result themselves.

SQLite schema 15 records the complete window and parent/reused-child read fences.
Captured creation output, filenames and timestamps survive interruption without
replanning changed templates. Replay creates nothing twice. Group Undo removes
only the action's new unmodified children; reused children and historical notes
remain owned by their original actions. Read fences are checked before each file
exchange and on recovery, alongside per-file CAS.

Snapshots, filters, totals, groups and reminder plans share a canonical relation
from cached task metadata and make no provider calls or writes. A materialized
child suppresses its parent's virtual date even when the child's own dates put
it outside the requested window. Child state and per-date overrides win over
parent lists. Duplicate identities and unresolved parents produce visible
problems. A historical child's own dates, state and reminders remain usable if
the parent rule changes or disappears; duplicate children produce no ambiguous
reminder deliveries. A uniquely created repair note suppresses an active creation
problem while preserving the original failure history and separate Undo ownership.

Hosts must expose an explicit series generation action and issue a separately
owned idempotent rolling mutation on startup and after sync/refresh for configured
rolling parents. Browsing and reminder reads never perform this maintenance.
Host adoption and final artifact acceptance are separate integration work.

Existing `set_completion`, `toggle_complete`, `set_status`, `edit_task`, and
status-bearing `update` commands recognize materialized children. A parent
instance command targets the unique existing child for the selected date.
The child revision fences child edits; a parent-targeted command fences the
parent, then captures and checks the authoritative child revision. Child
`occurrenceDate` is a selection fence, including timezone-resolved explicit
instants. `completedDate` uses the mutation's local completion day. Parent
instance membership uses the child's identity day; completion-anchor progression
preserves an explicitly selected instant separately from that day and the
mutation clock. Date-only selections keep date-only anchor semantics.
The child wins over contradictory parent instance membership for that day;
other corrupt list entries remain errors. Parent editor fields/body stay on the
parent, and child editor fields/body stay on the child. Filename title moves
compose reference updates over the staged child transition without discarding
completion. Original bytes, revisions and reference edits form one Undo unit.

Child skip uses `status.default_skipped`, or the first `status.skipped_values`
entry. Missing or inconsistent skipped/active workflow settings fail before
publication. Uncomplete/unskip retain later notes and never rewind `DTSTART`.
Atomic batches support transitions of pre-existing parents and children; they
reject a newly created or newly relocated transition target before effects.
The existing 1,000-command bound also bounds followup intents, with duplicate
parent/date intents reused rather than truncated.

SQLite schema 14 stores parent/child dependency fences and immutable successor
plans separately. Fences are checked before each exchange and during recovery.
For `on_completion`, the applicable completion/skip trigger captures next-note
bytes, template output and configuration before primary publication. Its
followup becomes runnable atomically with the primary receipt commit. A failed
followup preserves successful completion; pending host failures can resume on
refresh or replay without duplicate writes/uploads. Grouped Undo cancels
unstarted followups and removes only its own unmodified created successors.
Reused successors remain intact; foreign or newer edits block Undo.

The read-only feature request `occurrence_successors` takes `mutationId` and
returns the closed `occurrenceSuccessors` schema: at most 1,000 items with
`successorId`, `parentPath`, `occurrenceDate`, `state`, and nullable typed
`failure`. States are `staged`, `pending`, `applied`, `failed`, and `cancelled`.
Failed creation reports actionable snapshot problems; callers can explicitly
materialize the reported date with a new mutation after resolving the cause.
Native hosts must adopt the shared request/response validation before exposing
this feature; it adds no UniFFI record fields.

Production today/upcoming expansion and recurrence progression share the rolling
planner's one-million work budget, including eager timeset preparation. Ordinary
queries return typed resource exhaustion without partial results or writes;
ordinary non-child completion rejects exhaustion atomically. Legacy reference
entrypoints retain their separate parity semantics.

For materialized children, future-search exhaustion preserves the primary child
completion or skip and parent instance membership. It leaves the parent's old
scheduled/due values intact when date progression remains owed. SQLite schema 16
stores a separate immutable deferred intent with the known child identity day,
original selected instant and completion context, final post-primary revision
fences and distinct parent/future debts. Immutable per-intent inputs are bound
to their owning transition separately from the final grouped publication fences,
so an atomic batch can retain several deferred children of the same parent.
Activation occurs with the primary receipt commit. The successor item
union distinguishes `materialize_occurrence` with a concrete date from
`deferred_progression` with `occurrenceDate: null`; its
`completedOccurrenceDate` identifies the child, and `childState` distinguishes
completed/skipped. Deferred states are `staged`, `failed`, and `cancelled`.

`repair_occurrence_progression` requires `progressionId`,
`expectedParentRevision`, and `expectedChildRevision`. Current valid inputs must
still identify the original authoritative child and terminal state. Repair does
not complete the child again or use the repair clock as its anchor. An older
completion-anchor debt conflicts before effects when a newer anchor would be
rolled back. Parent date
debt must be paid before optional creation can end with `policy_no_successor`;
`exhausted` separately denotes rule exhaustion. Budget exhaustion remains a
failure. A new repair owns its successors and a hashed resolution metadata effect
with exact before/after CAS. Metadata-only repairs are undoable without fake file
writes. Committed Undo restores the previous resolution and cancels its own
unstarted followup; newer resolutions or modified owned children block Undo.
The original failure and captured inputs remain immutable.

Two cached feature queries support host maintenance and restart recovery:

- `rolling_maintenance_plan` requires a canonical `referenceDate`; its targets
  provide parent revisions and finite effective bounds using the same Rust
  settings resolver as the mutation. `limit` (1–256, default 128) counts inspected
  task/problem rows, including excluded parents. Discovery does not expand rules.
- `occurrence_generation_failures` lists pending/failed concrete and unresolved
  deferred work without requiring retained primary IDs. Its inspected-row limit
  has the same range. Each item carries the original primary ID and either a
  typed repair command with fresh cached revisions or an explicit unrepairable
  identity/state reason. Supporting canonical relation discovery scans cached
  role metadata across the profile; that catalog work is not bounded by page size.

Both queries run within one SQLite read snapshot with no provider I/O, recovery,
body reads or writes. Their closed keyset cursors bind the profile, last row,
configuration and durable version; maintenance also binds the captured date.
Continuation requires `expectedVersion`. Task/config changes and no-file
generation-state, repair or Undo commits invalidate old pages.

Host adoption requires closed neutral-schema validation at each language
boundary, explicit series-generation/repair actions, and serialized durable
maintenance mutations after configuration/index readiness and settled initial
Sync. Hosts must use Rust discovery, coalesce their own refresh notifications,
and avoid permanent parent/day success caching: edits or deleted children need
fresh idempotent operations. Browsing and reminder planning never generate tasks.
These private core capabilities require native integration and acceptance before
any supported-profile or release-readiness claim.

Strict final-document writes validate recognized recurrence strings, parameter
ranges and anchors before provider effects. The permissive legacy recurrence
reader remains separate. Historical invalid recurrence data must be explicitly
repaired before strict edits can publish; ordinary edits never silently reinterpret
such tasks as nonrecurring.

Instance transition commands require valid day strings, disjoint lists, and
deterministic duplicate rejection. Missing optional lists mean no recorded
instances; their typed read rejects present null, non-list and malformed values.
In strict validation mode, create, update, editor and explicit normalization
writes block invalid resulting mapped lists before publication. Permissive
mode retains the existing validation policy: malformed days, duplicates or
overlap can persist without a new receipt diagnostic. Instance transitions
still require valid, unambiguous original and planned sources in that mode.
A null property patch deletes a list, as it does other properties. The support
registry claims strict validation only; permissive warning parity and a broader
recurrence or temporal profile are not claimed.

Instance-source checks recognize configured physical fields and canonical role
keys; an otherwise unknown snake-case physical key keeps the existing unknown
field behavior. Semantic command role aliases remain supported. Skip and
recurring completion reject differing recognized sources before projection can
hide one source. Their final planned document must also remain unambiguous:
identical duplicate sources cannot silently diverge when only the configured
primary field would change. This is a bounded blocked state requiring a reviewed correction
of the actual physical fields; normalization is not an automatic repair.
Its existing alias-conflict policy can retain conflicting legacy keys.

Editors use `edit_task` when saving properties/body together with a status
transition. It accepts `path`, optional `expectedRevision`, non-status
`properties`, optional `body`, optional `status`, and optional `occurrenceDate`.
The transition sees staged edits to recurrence and dates; all
changes use one original revision fence and journal/Undo unit. Status values in
`properties`, including configured physical aliases, are rejected. Null or
absent body/status leaves that value unchanged. A malformed existing note must
be explicitly repaired with known required metadata before ordinary edits can
publish; normalization never invents its historical creation date.

`featuresJson` request `conformance` exposes the shipped support registry, cached
configuration provider status, and explicit outstanding profile requirements.
Metadata reads work while a replica waits for configuration and never contact
the provider. Optional capability claims currently cover durable partial batch,
and concurrency fences. Profiles remain unclaimed while their
runtime requirements are incomplete; pure fixture coverage does not grant a
profile claim. The full pinned corpus enforces the explicit Facet compatibility
contract below while reporting raw upstream matches separately. Passing that
contract does not grant an upstream profile or prove native acceptance.

`featuresJson` request `{ "kind": "sync_status" }` returns a coherent, read-only
snapshot for one registered profile: `schemaVersion`, `profileId`, `profileKind`,
`version`, `initialSyncComplete`, `pendingRemoteCount`, `pendingUploadCount`,
`conflictCount`, and `pendingMutationCount`. The language-neutral contract is
`facet-engine.schema.json`'s `syncStatus` definition. Counts reflect persisted
checkpoint notices, upload rows (including conflict-blocked rows), conflicts,
and uncommitted journal/partial-batch work units. `version` is the vault/index
sequence, not a Sync status cursor. A cloud profile without a valid checkpoint
cannot report initial synchronization complete. Local folders report local
readiness explicitly through `profileKind: "local_folder"`.

This projection performs no provider I/O and contains no file paths, payloads,
or secrets. A drained durable snapshot alone does not prove cloud convergence:
hosts must also check the current transport, lifecycle phase, and pending host
work, then verify expected replica contents for live acceptance.

`featuresJson` request `reminder_plan` returns the `reminderPlan` contract from
cached SQLite configuration and task metadata, with no provider I/O. Callers
supply RFC3339 `at`, `from`, `to`, an IANA `timezone`, and optional `limit`
(1–128). The positive window is `[from,to)`, at most 366 days; past firings
before `at` are excluded. Rows sort by instant, reminder ID, then task path.
`after`/`nextCursor` contains `fireAt`, `reminderId`, and `taskPath`; subsequent
pages require the same `expectedVersion`. `totalCount` is the complete eligible
count before paging. `problemCount` is the complete error count, while `problems`
retains the first 128 deterministic diagnostics. Waiting or invalid configuration
raises a typed error, so hosts retain prior OS schedules until a valid plan.

The projection resolves mapped roles, configured date-only local anchor time
(default `00:00`), offset-qualified instants, and completion/archive/recurring
instance eligibility. It follows the current stored due/scheduled anchor;
recurrence progression changes that anchor. Stable opaque notification IDs
include the profile, task path, reminder ID, firing instant, and occurrence.
Relative offsets preserve exact nanoseconds. Year/month durations use fixed
365/30 days, matching the pinned [plugin notification service](https://raw.githubusercontent.com/callumalpass/tasknotes/4.13.8/src/ui/NotificationService.ts).
A local DST fold selects the earlier instant; a nonexistent local anchor becomes
an explicit diagnostic. Hosts only reconcile OS notifications after completing
pages from one version; Rust owns reminder scheduling semantics. OS delivery and
full reminder operation capability remain separate acceptance requirements.

Applied create/edit/update receipts expose authoritative nullable `taskPath`.
Title renames and reference rewrites commit this primary identity in the same
durable receipt; retries replay it unchanged. Historical receipts and commands
without one primary task expose null. Hosts never choose a task from affected
`paths` or infer its filename from its title.

Every wire receipt requires `diagnostics`, containing at most three unique
objects with only `code`: `template_missing`, `template_parse_failed`, or
`filename_shortened`. Template warning fallback handles missing/invalid template
content; provider and storage failures propagate. Planned diagnostics persist
before file effects and replay unchanged after reopening or changing settings.
Schema 10 and earlier receipt metadata receives an explicit empty array during
migration when the field was absent. Present malformed diagnostics fail migration;
missing or changed committed diagnostics fail subsequent reads and replay. Native
wire decoders require the field.

Production body templates parse complete frontmatter delimiter lines and expand
parsed YAML scalars and mapping keys once. Inserted user text cannot introduce
new YAML structure or a second variable expansion; duplicate expanded keys fail.
Variables use the original supplied instant and timezone, including local week
and DST-aware zettel time. `nano` is deterministic from that instant, while UUID
filenames require a UUID supplied as the mutation identity. Automatic UUID creates
in a multi-create atomic batch are rejected before effects; issue separate UUID
mutations for distinct task entropy. Partial-batch child identities are not UUIDs.

Production filename selection preserves Unicode and applies platform component
and total-path limits, reserved names, bounded collision suffixes and deterministic
shortening. A lossy filename keeps the mapped semantic title. SQLite schema 11
stores its owned title policy alongside original journal images; body edits,
same-title remote updates and Undo preserve that policy. Unknown external notes
retain filename-derived titles, and changed title mapping yields a visible problem.
Mutable payload origin lives in side-state metadata, so migrating origin does not
rewrite immutable payload BLOB rows.

Time tracking, Pomodoro timers, work reports and time estimates are outside the
product. Existing timing frontmatter remains opaque custom metadata and survives
ordinary task edits, completion and Undo. SQLite schema 12 retires private device
timer state and timer effects; it retains staged task images, journal identities,
receipts and upload ownership so historical task writes can recover safely.

`featuresJson` request `undo_available` returns the `undoAvailable` contract:
eligibility, the latest eligible receipt ID, original clock, and command kind.
Undo eligibility follows durable journal order and excludes remote, no-op,
timer-only, already-undone, and partial-parent records. Earlier receipts are
rejected even when their file bytes still match. Provider revision checks remain
required when applying Undo. Legacy conflict receipts without a captured clock
expose a null clock rather than inventing one.

`rename_references` accepts `path`, `newPath`, optional `expectedRevision`, and
`updateReferences`. Changed reference documents join the source/destination
journal with their own revision fences; aliases, anchors, and surrounding bytes
remain intact. Ambiguous filename references fail before publication.
`delete_checked` accepts `checkBacklinks` and explicit `force` alongside the
ordinary path/revision fields. It rejects referenced files unless force is set.

`batch` commits one grouped file journal. `batch_partial` instead runs up to
1,000 independent commands, retaining each original child mutation and outcome
before advancing. Empty partial batches are valid. Nested batches, Undo,
and conflict decisions are rejected. An uncertain pending child stops
the batch for exact retry; definite item failures remain in its durable outcome.
The parent receipt means orchestration completed, so consumers inspect individual
items rather than treating it as success for every command. The `batch_outcome`
feature returns the versioned `batchOutcome` contract. Successful child receipts
can be undone individually; the partial parent has no grouped before-image.

`normalization_preview` reads known aliases and datetime spellings without
writing. Its `normalizationPreview` response preserves unknown fields, date-only
values, links, and recurrence data. Explicit `normalize` mutations apply reviewed
changes through the normal revision-fenced journal and retain exact before-images
for Undo. Keep a vault and private SQLite backup before bulk normalization.
Compatibility behavior is never silently enabled. Removing compatibility
requires release notes, at least one documented release of warning, explicit
migration tooling, and a documented version boundary.

Creation reads the effective task folder and title policy. Filename title
storage uses the semantic title; frontmatter title storage supports title,
slug, custom, and clock-derived names. Zettel/timestamp names use local
`yyyyMMddHHmmss` from the explicit execution timezone. Generated collisions use
the first unused numeric suffix, beginning with a space followed by `(2)`. Enabled body templates
expand portable task/date variables and merge template fields with explicit
creation/default/system values taking precedence. Archive supports a mapped
field or tag and an optional configured destination folder.

Refresh streams one file at a time into a staging table, then commits a complete
index generation. A failed scan leaves the previous snapshot intact. Initial
Sync may persist raw files before configuration arrives; normal indexing begins
after settings are discovered or standard defaults are approved.

Protocol checkpoints store cursor/header metadata separately from pending UID
rows. `applySyncCheckpointDelta` commits both atomically; a host acknowledges the
session barrier only after it succeeds. Full checkpoint loading reconstructs
pending notices for session restart without quadratic bootstrap rewrites.

Journal, base, outbox, conflict, and Undo slots reference owner-scoped immutable
SQLite images. Migration from database version 9 streams old BLOB rows in 1 MiB
chunks inside an atomic transaction, preserving identifiers and outbox sequence
high-water. SQL metadata updates copy image references instead of full BLOBs.
JSON upload/conflict lists carry metadata only. Conflict and retained-backup pages
are limited to 128 entries. `openDisplacedSnapshot` reads one retained predecessor
through bounded chunks. Its acknowledgement follows durable Rust retention.

`beginPayload(profile, id, size, revision)` returns an owner-fenced
`FfiFacetPayload`; `openPayload` reopens the same caller identity. `infoJson`
follows the neutral `payloadInfo` definition: schemaVersion, id, size, revision,
written and preparing/sealed/discarded state. The identity is a nonempty string
of at most 256 UTF-8 bytes without controls; blob: and sync: prefixes are reserved.
`writeChunk(offset, bytes)` permits only a contiguous prefix or an exact retry
of at most 1 MiB. `seal` verifies the declared SHA256; `readChunk(offset, length)`
returns an exact sealed range of at most 1 MiB. `conflictPayload(profile, id, role)`
returns a read-only retained-version handle or null for an actual tombstone.
Handle `closeHandle` leaves durable bytes intact; explicit `discard` retires only an
unreferenced incoming identity. Engine and profile lifetime fences are checked
in the same operation as image access, including after profile recreation.

New decisions use the ordinary `resolve_conflict` mutation with exact base,
local, remote, and current revision fences. `executePayloadIdJson` supplies a
sealed payload handle; the retry fingerprint includes payload absence
or its exact content hash. Decisions retain their original clock/context. The
receipt, preserved-version archive, and inbox removal commit atomically. Undo
restores the original inbox entry and retains the archived versions.
`featuresJson` requests `mutation_receipt` and `resolution_history` expose durable
decision state and archived metadata without provider reads. History IDs use
`archive:<mutationId>` with `conflictPayload` for a selected immutable version.

Remote ingest journals authenticated bytes, destination/source rename writes,
base, service UID, timestamps, and outbox revalidation before file effects.
Their SQLite commit is atomic; repeated identical notices recover that journal,
and changed content/metadata for the same UID is rejected. A session binds a
Weak engine reference, private profile, actual remote vault and durable binding
generation. `queueDurableUpload` loads the immutable outbox head into one Rust
encrypted frame; no full file crosses the foreign boundary. `DownloadedPayload`
returns an opaque transfer identity and metadata. `applyDownload(identity)`
stages authenticated bytes once, drops the protocol frame, and applies its exact
pending metadata, including relatedPath, outside the session mutex. Only then
may `completeRemote(uid)` emit its durable pending-removal checkpoint barrier.
Unbind/cancel drops transient frames without acknowledging pending notices.

Stop/drain the socket driver, unbind the session, then call `closeRuntime` before
disposing native callback owners. Concurrent close waits for active callbacks;
same-engine callback reentry into `closeRuntime` rejects typed Busy before changing state.
Bridge admission never waits on a profile coordinator under the session lock.
Busy preserves exact immutable intent for retry. Host Contract maps to permanent
HostContract with sanitized content-free diagnostics, rather than provider outage.
No callback executes while a SQLite or session mutex is held. Generated native
object disposal (`destroy`/`Dispose`/AutoCloseable `close`) only releases its Arc;
call the explicit runtime/handle lifecycle methods before disposing wrappers.

File callbacks and payload handles transfer at most 1 MiB per call. Protocol
binary pieces remain 2 MiB; one admitted encrypted file frame stays in Rust.
SQLite binary bytes are immutable incremental BLOBs, with mutable prefix/seal
metadata in separate rows. These bounds cover binary storage and bridge
primitives. Native socket/provider buffers require their own memory verification;
text parsing, complete client journeys and OS delivery are separate checks.

First-party workspace packages are GPL-3.0-only; see [LICENSE](LICENSE).
Third-party license notices retain their original terms.

Snapshots return all pending task paths separately from the single upload head.
Dependency state follows configured completion meanings and scoped link
resolution. Recurrence-aware date queries retain completed virtual instances;
`agenda` adds unfinished overdue tasks, while `inbox` requires an unfinished,
nonrecurring task without projects, contexts, due, or scheduled dates. `Query.today`
supplies the local civil date for date scopes and recurrence. `Query.at` remains
accepted for wire compatibility but is unused; there are no tracked-minute
projections. Capture context supplies project/context/tag/scheduled defaults;
explicit parsed values take precedence.

The explicit `todayAgenda` and `upcomingAgenda` scopes preserve the mobile
planning workflow without changing the existing `today`, `agenda`, `upcoming`,
or strict `inbox` policies. `todayAgenda` includes unfinished overdue work and
returns `agendaSection` keys `overdue`, `scheduled-today`, and `due-today`.
`upcomingAgenda` includes future ordinary planned dates and deadlines without a
seven-day cutoff; recurrence previews use a finite 366-day default or the
caller's `upcomingDays`. An existing unfinished recurring date remains its
completion target instead of being replaced by a later preview. Materialized
children remain the sole owners of covered occurrences.

Agenda rows supply the selected `effectiveDate` and `agendaDateKind` (`planned`
or `deadline`); the native host formats these facts rather than recomputing date
policy. These optional JSON fields are omitted outside the new scopes.
`groupBy: agendaSection` requires `todayAgenda` and orders its sections before
pagination. `effectiveDay` filters the projected civil day before pagination.
A projectless mobile Inbox uses `scope: all`, `hasNoProject: true`, and
`completed: false`; global Search uses `scope: all` and matches titles, bodies,
projects, contexts, and tags. The `scheduledDate`, `createdDate`, and
`completedDate` sort fields use their respective normalized properties, retain
instant ordering, and keep missing values last in both directions.
The separate shared `vault/facet-agenda-contract.json` corpus covers the new
query/row shapes without changing the original boundary corpus.

`obsidianTransportLimits` supplies the common framing policy: 4 MiB UTF-8 text,
2 MiB binary pieces, and the 199 MiB default plaintext file limit before service
negotiation. Hosts enforce framing limits before copying/queuing messages. File
encryption allocates one exact nonce/ciphertext/tag frame; owned authenticated
decryption reuses it. Native provider and cross-language memory peaks require
separate acceptance from Rust allocator measurements.

## Sync encryption reference

`obsidian-sync` implements encryption versions 0, 2, and 3: NFKC-normalized
scrypt key derivation, version-specific key proofs, deterministic encrypted
paths, and authenticated file content frames. Key material is zeroized and
debug output is redacted. Content encryption requires a fresh secure random
12-byte nonce from the host for every invocation.

Offline tests compare exact bytes with vectors generated by the pinned
official headless client, using public synthetic inputs only. The explicit
maintenance command `bun ci/obsidian-reference.ts` verifies the source hash,
extracts only its cryptographic reference functions, and regenerates the
vectors. Ordinary tests use committed vectors without downloading or running
the official client. See the [fixture provenance](../tasknotes-fixtures/vault/README.md).

Authentication and protocol effects are now exported through
`FfiObsidianAccount` and `FfiObsidianSession`. Native hosts perform HTTP/WebSocket
effects and explicitly acknowledge durable checkpoint barriers. Protocol tests
use synthetic pinned-reference transcripts; this evidence does not establish
live-service interoperability or store acceptance.

All 4,980 cases from the pinned TaskNotes specification are imported unchanged
and SHA-256 checked. The full corpus dispatches every original input once,
including rejected requests, and reports raw upstream matches separately. Exactly
43 named timing-withdrawal cases require independent typed rejection or opaque
preservation contracts, with supported-operation controls and real-engine
edit/Undo witnesses. Seven additional named inputs have the explicitly chosen
Facet contracts in `crates/tasknotes-vault/tests/facet_contract`: ambiguous links reject instead of
choosing a candidate; relative links normalize when they remain inside the
vault; a lossless filename-title rename preserves metadata without adding a
frontmatter title mirror; and conformance metadata stays conservative until
runtime/profile prerequisites are proved. The rename policy still preserves a
title value when a lossy or colliding filename cannot represent it. Timing
features are never advertised.

Each of those seven contracts binds its original case ID, operation and
canonical input SHA-256. Their independent assertions run even if the raw
upstream matcher happens to pass. Real-runtime witnesses exercise rename,
replay, exact-byte Undo, partial batch outcomes and stale-revision conflicts.
Unknown operations, changed inputs/operations, duplicate IDs, missing or
unconsumed contracts, false readiness and every unexplained mismatch fail.
Every other case retains its unchanged upstream comparison. The full gate
reports raw upstream matches, verified timing withdrawals and verified Facet
contracts separately; a passing Facet gate is not universal upstream parity.

Field-mapping tests execute all 139 cases: 129 retain their
upstream comparisons and 10 exercise explicit first-party contracts for withdrawn
timing roles, preserving their metadata without semantic remapping. Corpus
integrity, implemented operation tests, full specification conformance, native
runtime acceptance, and live Sync acceptance are separate claims.

Lint policy (no `#[allow]`, no unwrap/panic behind the FFI, deny `as` casts,
deterministic iteration) is encoded in `Cargo.toml` workspace lints,
`clippy.toml`, and `deny.toml` — the comments there are the rationale.
