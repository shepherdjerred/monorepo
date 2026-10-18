# toolkit

`toolkit` is the command entrypoint for the complete monorepo stack. It gives
native platform CLIs stable monorepo defaults and retains the workflows that
only make sense in this repository: deployment tracing, PR health and review
media, alert/error triage, screenshots, Discord sessions, and private agent
history.

See [AGENTS.md](AGENTS.md) for implementation invariants and contributor notes.

## Install and run

```bash
# Run from source
bun run src/index.ts pr health

# Compile a standalone binary to dist/toolkit (ad-hoc signed on macOS)
bun run build

# Install globally to ~/.local/bin/toolkit
bun run install:local
```

## Delivery

`toolkit deploy` uses the Delivery service's shared API and validated contracts.
PostgreSQL owns release selections and deployment history. Desired, observed,
and accepted releases are distinct states; an accepted build is not proof that
an environment is running it.

```bash
toolkit deploy whoami
toolkit deploy status --json
toolkit deploy versions arcade
toolkit deploy inventory --json
toolkit deploy diff none <VERSION_SET_ID>
toolkit deploy start <ENVIRONMENT_ID> <VERSION_SET_ID> --request-id <REQUEST_ID>
toolkit deploy promote <SOURCE_ENVIRONMENT_ID> <DESTINATION_ENVIRONMENT_ID>
toolkit deploy approve <DEPLOYMENT_ID> --reason "Reviewed release and checks"
toolkit deploy wait <DEPLOYMENT_ID> --timeout 900 --json
toolkit deploy rollback <ENVIRONMENT_ID> <VERSION_SET_ID>
toolkit deploy workers list <ENVIRONMENT_ID> --json
toolkit deploy workers baseline --file <REVIEWED_BASELINE_JSON> --machine
toolkit deploy workers adopt --file <REVIEWED_ADOPTION_JSON> --machine
toolkit deploy workers retire <ENVIRONMENT_ID> <WORKER_ID> --request-id <REQUEST_ID>
toolkit deploy workers recover <DEPLOYMENT_ID> --machine --expected-generation <GENERATION> --reason "Inspect the exact quarantined operation independently"
toolkit deploy workers recovery <INTENT_ID> --json
toolkit deploy minecraft recover <DEPLOYMENT_ID> --machine --expected-generation <GENERATION> --reason "Inspect the original before selecting another candidate"
toolkit deploy minecraft recovery <INTENT_ID> --json
toolkit deploy forum publish --file <PRIVATE_BUNDLE_DESCRIPTOR> --machine
toolkit deploy forum baseline --file <ORIGINAL_BASELINE_DESCRIPTOR> --machine
toolkit deploy forum inspect <INTENT_ID> --json
toolkit deploy forum recover <DEPLOYMENT_ID> --machine --expected-generation <GENERATION> --reason "Inspect and settle the frozen forum release under retained ownership"
toolkit deploy forum recovery <INTENT_ID> --json
toolkit deploy sites recover <DEPLOYMENT_ID> --machine --expected-generation <GENERATION> --reason "Inspect and settle the frozen archive under retained ownership"
toolkit deploy sites recovery <INTENT_ID> --json
toolkit deploy platform request --file <REVIEWED_INTENT_JSON>
toolkit deploy platform control-plane --file <REVIEWED_CONTROLLER_JSON> --machine
toolkit deploy platform recover <DEPLOYMENT_ID> --machine --expected-generation <GENERATION> --reason "Independently settle the original native infrastructure operation"
toolkit deploy platform recovery <INTENT_ID> --json
toolkit deploy platform recovery-approve <INTENT_ID> --plan-fingerprint <HASH> --decision approved --reason "Reviewed exact saved recovery plan and state"
```

The default endpoint is `https://delivery.tailnet-1a49.ts.net`; override bootstrap
with `--url`, `DELIVERY_URL`, or `[delivery].url` in the toolkit config. Requests
use the identity supplied by trusted Tailscale ingress. Toolkit never supplies
identity headers. Production approvals and rejections require a human identity.

Machine operations explicitly use `--machine`, which resolves
`DELIVERY_API_TOKEN` through the credential broker. Its default locator selects
the provisioned `DELIVERY_ADMIN_TOKEN` field of the Delivery service item in the
homelab 1Password vault. A `[credentials].DELIVERY_API_TOKEN` locator can select a
different provisioned credential. The token must have the necessary server-side
scopes. Machine tokens cannot approve production releases, including admin tokens.
There is no token command-line option and credentials are never printed.

Platform recovery keeps the original failed result and held ownership while a
bounded independent runner inspects the native targets. A partial OpenTofu
recovery records an encrypted saved plan; the human approval above binds its
public fingerprint and never accepts replacement bytes. Routine stack policies
remain automatic. `recovery-approve` rejects `--machine`, including admin tokens.
Control-plane upgrade requests are admin-only and always target the separately
owned `delivery-control-plane/prod` environment.

`deploy trmnl repair <failed-deployment> --machine --expected-generation <N>
--reason <explanation>` requests a fixed same-bundle dependency repair. It transfers
the failed release's quarantine only after fresh executor proof that the source
Workflow stopped; it cannot choose plugins, replace the bundle, mutate Argo, or
accept an application release. Inspect it with the ordinary `deploy status` and
`deploy wait` commands.

Mutations use the currently read environment generation unless
`--expected-generation` is supplied. Concurrent changes are rejected by the
service. Use `--request-id` to repeat a request after a lost response; generated
request IDs are printed to stderr before submission. Cancellation waits for a
safe boundary. Retry creates a new attempt and reevaluates required approval.
Rollback selects an exact previous release and does not restore persistent data.

`workers baseline` submits an admin-only `adopt-worker` intent containing an
exact full-app version set, environment generation, request ID, and
`workerBaseline: { artifactIds, candidateArtifactId }`. It verifies existing hosts
independently, including a routed worker older than the current Activity image.
It establishes retained host identities without changing or accepting the full
application release. Its completion requires executor observations, and it cannot
be selected as an application rollback target.

Worker adoption is admin-only and references an original qualified artifact and
its accepted introducing deployment, an exact environment generation, a request
ID, and a fixed `central`, `scout-beta`, or `scout-prod` target. It accepts no pod
specifications or secret values. `workers list` preserves original artifact/build
identity and distinguishes desired hosted workers from retained zero-host rows.
Retirement reads both environment and worker generations; override the latter
with `--expected-worker-generation` for an explicit compare-and-swap. The request
freezes a normal deployment and requires production approval where applicable.
Only executor-side fresh routing and drainage proof may authorize scale-to-zero;
requesting or approving retirement does not stop a host. A canceled or failed
retirement requires a new retirement request rather than the generic retry command.

Worker recovery creates an admin-authorized inspection intent bound to the reviewed
environment generation and immutable deployment/pool identities. Its independent
executor verifier must observe all operations settled, exact original hosts and
stable routing before completing the intent. Completion releases quarantine while
preserving the original failed result; it does not accept a release or change
worker replicas. The same verifier has an operator entrypoint for a Workflow-worker
outage and uses a separate scoped executor credential, never the admin intent as proof.

Minecraft recovery is admin-only and applies before candidate Argo source
selection. Its controller reopens only the untouched original and removes only
the exact request-owned validation copy. The API independently rereads original
volume, Pod, routes and settled Argo bindings before releasing quarantine through
an environment-generation CAS. Missing source journals, changed identities or
post-selection operations retain the lock and require the independent restoration
procedure. Recovery never accepts or retries the failed release. The UI shows
recovery history; `minecraft recovery` returns the same frozen inputs and status.

Forum publication uses the separately brokered `DELIVERY_PUBLISHER_TOKEN`;
baseline requests use the admin credential. Publication registers immutable private
licensed bytes for independent qualification and cannot adopt a runtime or approve
a release. The read-only baseline descriptor includes request ID, environment ID,
expected environment generation, qualified original image/bundle artifact IDs and
a reason. Native completed Job, Pod digests, installed XF and bundle observations
come from the API's independent authenticated inspector. `forum inspect` reads the
same immutable proof shown in the UI; the baseline never invents deployment acceptance.

`sites recover` and `forum recover` request a separate admin-authorized recovery
intent for a failed or canceled release that retains its target lock. Requests
bind the reviewed environment generation and reason; the caller supplies no
native observations. Inspection and bounded repair retain the original archive
or forum inputs. Independent native readback and generation checks govern
settlement. A failure or refusal keeps ownership; successful recovery releases
quarantine while preserving the failed deployment and accepted pointers.
The matching `recovery` command and UI expose frozen operation identities,
native receipts and refusal reasons. This path cannot authorize an image-only
database rollback or delete a foreign maintenance lock.
The request does not start automation. Pause the dispatcher Schedule and run
`bun packages/temporal/scripts/rollout/content-delivery-recovery.ts --intent <ID>
--action inspect|repair --context admin@torvalds --url <DELIVERY_URL>` through
the existing operator credentials. The command journals and stops the ordinary
Activity host before effects and restores it after independent settlement.
Retry the same intent after interruption; do not manually pre-scale the host.
Static repair resolves `DELIVERY_SITE_ACTIVATOR_ACCESS_KEY_ID` and
`DELIVERY_SITE_ACTIVATOR_SECRET_ACCESS_KEY` from the dedicated activator item,
and `CLOUDFLARE_API_TOKEN` from the six-zone cache-purge item. An absent purge
credential stops recovery; the general `CF_API_TOKEN` is not a fallback.

All commands support `--json`. `wait` polls in the foreground and returns 0 for
success, 1 for a failed/canceled deployment, and 2 when its deadline expires.
Other errors return 1. Timeout never reports a queued or approving deployment as
failed. Run `toolkit deploy --help` for every operation.

Bootstrap uses reviewed JSON files and an admin machine credential:

```bash
toolkit deploy pipeline register <PIPELINE_REVISION_ID> --file <DEFINITION_JSON> --machine
toolkit deploy environment register --file <ENVIRONMENT_JSON> --machine
toolkit deploy import --file <SNAPSHOT_JSON> --machine
toolkit deploy imports --json
```

Pipeline and environment files conform to the shared Delivery contracts. Import
files contain an explicit request ID, service ID, capture timestamp, source
(`version-catalog`, `argocd`, or `runtime`), component references, and evidence.
Imports remain unverified migration snapshots: they do not manufacture CI
qualification, make artifacts eligible, or change desired environment state.

## Tracker

`toolkit tracker` talks directly to the private tracker over tRPC and needs no
credential. Reads never observe an actor. Mutations identify each native AI
session; resumed sessions retain their key and votes remain idempotent.

```bash
toolkit tracker whoami --json
toolkit tracker issue search "browser bootstrap" --team AI --all-states --include-archived --json
toolkit tracker issue list --team AI --project developer-experience --label Improvement --limit all --json
toolkit tracker issue create --team AI --title "Tool: failure" --description-file /tmp/issue.md
toolkit tracker issue vote AI-26 --note "Blocked tracker UI verification"
toolkit tracker issue update AI-26 --state started --expected-revision 3
toolkit tracker issue comment add AI-26 --body-file /tmp/comment.md
toolkit tracker issue attach AI-26 /tmp/screenshot.png
```

Every command accepts `--json` and `--url`. Settings resolve from environment,
`~/.toolkit/config.toml`, then defaults: `TRACKER_URL` / `[tracker].url` and
`TRACKER_ACTOR_NAME` / `[tracker.actor].name`. Noninteractive scripts set both
`TRACKER_ACTOR_KEY` and `TRACKER_ACTOR_KIND` (`human`, `agent`, or `runner`).
CLI `--actor-key`, `--actor-kind`, and `--actor-name` override those values.
`TRACKER_ACTOR_MODEL`, `TRACKER_ACTOR_PLAN`, and `TRACKER_PARENT_ACTOR_KEY` add
optional metadata. Arbitrary environment variables are never recorded.

Codex uses `CODEX_THREAD_ID` directly. The dotfiles install a Claude SessionStart
hook through `CLAUDE_ENV_FILE`, a Cursor Shell `preToolUse` hook through
`updated_input`, and an OpenCode `shell.env` plugin. They forward the native
session ID and select the child harness when another harness launched it.
Claude model detection reads only the transcript explicitly provided by that
session's hook. Missing session identity fails with an actionable error.
Install the compiled toolkit before activating these hooks; existing sessions
need a restart or their explicit native session environment.

`tracker api <procedure> --input-json '<JSON>'` is the query escape hatch;
`--mutation` adds the same validated actor. Additional catalog mutations use
this API. `tracker --help` lists the complete command tree. The former
`toolkit linear` write passthrough is removed; all issue operations use Tracker.

The operator migration commands preserve an immutable Linear snapshot and its
file checksums. Export is read-only and paginates all archived records through
the read-only GraphQL migration adapter. Its dedicated
`LINEAR_MIGRATION_API_KEY` resolves through the registered password-manager
reference only for export, source verification, and private file downloads.
It is never forwarded to redirect destinations. No Linear CLI is required.

```bash
toolkit tracker migration export-linear --output /private/tmp/linear-export
toolkit tracker migration import-linear --input /private/tmp/linear-export --dry-run
toolkit tracker migration backup-linear --input /private/tmp/linear-export --profile seaweedfs
toolkit tracker migration verify-linear --input /private/tmp/linear-export
toolkit tracker migration import-linear --input /private/tmp/linear-export
toolkit tracker migration import-linear --input /private/tmp/linear-export --resume
toolkit tracker migration catch-up-linear --previous /private/tmp/linear-export --input /private/tmp/linear-export-new --dry-run
toolkit tracker migration catch-up-linear --previous /private/tmp/linear-export --input /private/tmp/linear-export-new
```

`--resume` on export continues downloads from the frozen source snapshot.
Import always relies on server idempotency and can resume after an uncertain
response; a completed rerun reports only `unchanged` records. `--only TYPE`
imports one entity stage whose prerequisites have already been applied.
Dry-run validates every reference and local file before any destination access.
Project/document comments stay in the private export. Project upload links require
an explicit destination association and block preflight instead of importing broken links.
Import rejects native issue collisions and requires normal writes to be paused.
Open `tracker-imports-enabled` only for the explicit import window, then close
it before enabling native writes. Compare the final source snapshot with Linear
before cutover; new or changed source data requires reconciliation rather than
silently overwriting an earlier imported record.

Catch-up takes two checksummed snapshots. It appends new records in dependency
order and reconciles source issue/comment edits only when the previous import
hash and current destination fields still match. Every edit adds an audit event;
the first import event and original actor observations remain intact. A repeated
snapshot pair makes no new writes. Removals, changed catalog definitions and
edited vote records fail preflight and need explicit reconciliation. Back up the
new snapshot and verify it against Linear before closing the import window.

`--retain-removed <ID>` explicitly preserves an already archived issue missing
from the newer export, along with its first import event. Repeat the option for
each historical copy to retain. It rejects active or unknown identifiers and
other removed records. Retained issues keep their original fields and remain
outside the active queue. Existing actors keep their original observations when
the source still identifies the same actor key and kind.
For later snapshot pairs, provide `--retention-source OLD` with the original
checksummed export containing those archived copies and repeat `--retain-removed`.

Backups use the private `tracker-attachments/import/` prefix and verify every
object by reading its bytes back. Keep the export directory private; never
commit or upload its contents through `pr asset`.

## Platform commands

Platform commands delegate to native CLIs. Explicit flags and environment
values override the monorepo defaults.

| Command      | Native CLI       | Monorepo default                                     |
| ------------ | ---------------- | ---------------------------------------------------- |
| `gh`         | `gh`             | `GH_REPO=shepherdjerred/monorepo`                    |
| `woodpecker` | `woodpecker-cli` | Woodpecker CI; server and token from the environment |
| `git-spice`  | `git-spice`      | Current checkout                                     |
| `posthog`    | `posthog-cli`    | Project `549883`                                     |
| `grafana`    | `gcx`            | Context `homelab`                                    |
| `prom`       | `gcx metrics`    | Context `homelab`                                    |
| `loki`       | `gcx logs`       | Context `homelab`                                    |
| `tempo`      | `gcx traces`     | Context `homelab`                                    |
| `temporal`   | `temporal`       | `--profile homelab`                                  |
| `argocd`     | `argocd`         | Homelab server and `--grpc-web`                      |
| `cf`         | `cf`             | Native configured context                            |
| `tailscale`  | `tailscale`      | Native local daemon                                  |

Everything after the selected platform command is preserved, including
`--help`, `--version`, and the `--` argument boundary. The child inherits the
current directory, environment, and terminal streams. Toolkit mirrors its exit
status or signal and returns 127 when the native executable is missing.

```bash
toolkit gh pr view
toolkit woodpecker pipeline ls shepherdjerred/monorepo
toolkit tracker issue view SJ-123
toolkit posthog api search read-data-schema
toolkit prom query 'up == 0'
toolkit loki query '{namespace="temporal"} |= "error"' --since 1h
toolkit tempo query --help
toolkit grafana alert rules list
```

Common plumbing such as `git`, `bun`, `kubectl`, `helm`, `tofu`, `aws`, `op`,
`promtool`, and `logcli` stays directly invoked.

## Monorepo workflows

### Wait for CI and merge readiness

`toolkit ci maintenance --json` reports recent explicit maintenance runs and
the durable Temporal coordinator's memo key. It distinguishes release notes, CI
image refreshes, and superseded source requests from normal main recovery.
Maintenance success is never merge-readiness evidence. Inspect a failed or
ambiguous submission and its coordinator state before retrying it.

```bash
toolkit ci wait                         # Infer the PR for this branch
toolkit ci wait 3447 --json             # One final report; progress on stderr
toolkit ci wait 3447 --until settled    # Collect all blocking check results
toolkit ci wait 3447 --timeout 2h       # Optional deadline; no default deadline
toolkit ci explain 3447                # Current blockers and bounded failure logs
toolkit ci main                        # Current main verification and last completed verdict
toolkit ci load                        # Queue, compute/gate admission, CPU/memory/disk/I/O
toolkit ci timings --since 72h --json   # Recent timing cohorts and per-workflow phases
toolkit pr review list 3447 --json      # Human and provider feedback with full bodies
```

CI commands resolve `WOODPECKER_TOKEN` through the registered credential broker,
as the native Woodpecker command does. An explicit token retains precedence;
custom server URLs or repository IDs require an explicit token.

`toolkit ci benchmark evidence <PIPELINE> --head <full SHA> --variant baseline|candidate`
recovers a terminal manual verify canary's retained resource evidence without
submitting another job. It asserts the source, pipeline, workflow and variant,
checks sample coverage, cumulative counters and scratch filesystem capacities,
and reports command, native wrapper and collection outcomes separately. It reads
`ci-handoff` using the standard AWS configuration with profile `seaweedfs`;
`--profile` selects another configured profile. Reads are bounded to 128 MiB.
Use `--archive` to retain a sanitized resource report under its own SHA256,
including the source artifact's SHA256, and verify the written bytes by readback.
Task inputs, commands, logs and environment values are omitted. Source hashes and
archive readback compare original bytes; malformed source UTF-8 fails strictly.
Exit 0 means complete collection, healthy observed resources and successful
command/native wrapper outcomes; 1 means a recorded failure; 2
means invalid arguments, identity mismatch or an upstream failure.

This command reports a component of qualification. Filesystem observations can
miss transient peaks; disk baselines describe a shared filesystem rather than
directory usage. Pod identity and restarts, quiet windows, physical device
writes, setup/publication/settling and paired runtime comparisons require
separate evidence. Its physical and production qualification fields remain
false. A failed workload can still retain complete resource evidence.

`wait` pins the initial PR head (or asserts `--head <full SHA>`), subscribes to
Woodpecker events before reading status, and refreshes GitHub metadata every
30 seconds. Repeated REST reads send the previous `ETag`; GitHub does not
charge an unchanged `304` against the shared 5,000/hr REST quota, so a
steady-state poll is nearly free. It returns as soon as a blocking check fails, merge conflicts
appear, human intervention is needed, or all merge requirements pass. A ready
candidate gets a fresh check of head, base, pipeline attempt, rules, and main.
`--until settled` waits for the remaining blocking results after a CI failure;
head changes and structural blockers still return immediately.

PR observation considers both normal PR pipelines and signed ready-for-review
metadata pipelines for the exact head. Title and label changes cannot replace
verification evidence. A green draft preflight cannot make a ready PR mergeable;
the full pipeline and its own published completion verdict must pass.

Woodpecker workflow results and the `ci-complete` gate determine hard CI
failures. Failed service cleanup children inside successful workflows do not
block a merge. Required GitHub checks must also publish success for the current
pipeline; optional external checks are advisory. Human approval is required
only when the effective branch rules require it, or a human requests changes.
A branch behind main is acceptable when the branch rules do not require it
to be current.

`toolkit ci source-proof <PR> --source <40SHA> --json` performs a bounded
post-merge bootstrap read. The source must equal the actual reviewed PR head
and the successful completed full Woodpecker pipeline, including the native
review and completion gates and all current required checks. GitHub must show
the PR merged and bind its actual associated merge commit to current main by
ancestry. The reviewed head must be an ancestor of that merge commit, or its
complete Git tree must equal the merge commit's tree exactly. The latter permits
squash merges without assigning checks to unreviewed bytes. A different tree
requires a source update and renewed CI/review. The strict v2 result records the
proof kind, original source, associated merge, tree identities and current main.
Two independent Git reads and fresh snapshots must preserve all identities,
successful pipeline, checks and review evidence. Bootstrap descriptors, builds and effects
must use that exact source, and refresh this proof immediately before effects.
Normal `ci wait` readiness and its closed-PR behavior remain unchanged.

Long queues and builds are normal. Keep awaiting the same foreground process;
do not restart polls or diagnose an outage from elapsed time alone. A sparse
heartbeat appears every five minutes. Disconnects reconnect with backoff and a
fresh snapshot. When GitHub refuses a read because a rate limit is exhausted,
the wait prints the limit and reset time to stderr, sleeps until the reset
(plus a few seconds of jitter), and resumes polling; a reset past `--timeout`
ends with the timeout outcome. `load` reports each unavailable telemetry source explicitly.

`explain` and wait reports include pipeline elapsed time, workflow start delays,
time without any active workflow, and per-step API phase timings in JSON. The
report identifies the pipeline attempt and numeric workflow IDs. The string
`taskId` matches the native pod task-UUID label: Woodpecker 3.19 uses the workflow
ID's decimal representation for both its queue and backend task ID. API phase timings
include admission and pod startup; they are not process CPU time. Parallel phases
overlap and must not be added together to estimate elapsed pipeline time.
Missing timestamps remain unknown, including activity totals with incomplete
workflow evidence. Live intervals account for local clock skew. Completion delay
is a lower bound because the pipeline API does not identify required dependencies.

`timings` reads every pipeline created in the requested window, with four detail
requests at a time. It groups actual workflow shapes into draft, noop, ready PR,
main, maintenance, and other work, then separates attempts and outcomes. Each
cohort reports successful latency sample counts and nearest-rank p50/p95 values;
failed or canceled runs do not become successful latency samples. Individual
step distributions expose checkout, review, verification, publication, and
deployment costs. They overlap and are not additive. Structured checkout and
toolchain and dependency-install measurements are reported separately from native step durations;
toolchain bootstrap excludes workspace dependency installation. Checkout byte
counts measure stored Git objects, not network traffic.

The native API exposes only the latest attempt. The command also reads successful
clone, review, verification, draft-preflight and maintenance command logs, with
four concurrent requests and an 8 MiB limit per step. Missing, malformed or
oversized evidence stays unknown; raw logs are never copied into the report.
Final structured review signals distinguish exact-head completion during this
pipeline (`fresh`), completion before it (`reused`), both (`mixed`), and a gate
passing solely on quota exemptions. Provider details preserve partial quota
coverage; the existing gate can pass with one completed provider. Rounded
timestamps at the run boundary remain unknown. Historical full verification of
drafts also has its own cohort. At least 30 distinct fresh successful ready heads
are needed to assess the target p95. This sample includes `mixed` gates with a
proven fresh provider while preserving their separate cohort. Reruns are excluded
and duplicate heads use the slowest eligible success. Sample sufficiency alone
does not certify the SLO.

Main is checked automatically. Push runs and full manual main runs contribute
to its verdict. A manual run must include verification, release admission,
image publication, chart publication and ArgoCD reconciliation without skipped
workflows; partial manual jobs cannot clear a failure. A failed last completed
run keeps main red while its recovery build is pending. Keep working if main is
red; do not try to fix main unless explicitly told. `ci explain --main` is an
alias for `ci main`.

| Wait exit | Meaning                                                       |
| --------- | ------------------------------------------------------------- |
| 0         | Merge ready                                                   |
| 1         | Blocking check failure or merge conflict                      |
| 2         | Usage, authentication, API, or contract error                 |
| 3         | Human intervention (review, draft, pipeline approval)         |
| 4         | PR head changed; explicitly start a new wait for the new head |
| 5         | Main red; keep working; fix main only when explicitly told    |
| 6         | Requested timeout; this does not mean CI failed               |
| 7         | PR closed or already merged                                   |

`--json` reserves stdout for one final JSON report. Failure reports include up
to three failed workflows with at most 60 lines / 4,000 characters of logs
each, review excerpts when relevant, and commands for deeper evidence.
Secrets and terminal control sequences are removed before truncation.
`explain` is a one-shot diagnostic; a pending report exits 0 and has
`ready: false`. SIGINT and SIGTERM cancel the foreground wait with exits 130
and 143. The command does not merge or mutate the PR.

GitHub credentials come from `GH_TOKEN` or `gh auth token`. One-shot commands
(`ci explain`, `ci main`, `pr health`, `pr review`) still exit 2 on a GitHub
rate limit, with the resource, used/limit, and retry time in the message.
`gh api rate_limit` is not authoritative for the shared bucket; read the
`x-ratelimit-*` headers of a real request instead.
The default Woodpecker connection resolves `WOODPECKER_TOKEN` through the
registered credential broker, preserving environment and credential-locator
config overrides. The broker uses `OP_SERVICE_ACCOUNT_TOKEN` or the enrolled
macOS Keychain credential for 1Password authentication. Custom `WOODPECKER_URL` or
`WOODPECKER_REPO_ID` connections require an explicit token. Load telemetry
uses the configured `kubectl` context and `gcx --context homelab`.

### PR health, reviews, and media

`toolkit pr health [PR_NUMBER] [--json]` combines three independent signals:

- a local merge-tree against freshly fetched `origin/main` and the exact PR
  head;
- the Woodpecker pipeline for that exact head SHA, including authoritative job
  state and `toolkit woodpecker pipeline log show <repo> <pipeline>` investigation commands;
- GitHub PR/check/review metadata from `gh` and the GitHub REST API.

GitHub’s status can lag or describe a different state. The exact-head
Woodpecker pipeline wins when they disagree. Healthy and pending reports exit 0;
unhealthy reports exit 1. JSON retains the top-level `prNumber`, `prUrl`,
`overallStatus`, `checks`, and `nextSteps` fields.

`toolkit pr review list [PR] [--json] [--all] [--provider NAME]` lists current,
unresolved feedback across human reviewers and registered providers. Each item
includes author, provider, nullable priority, full contents, path/line,
resolution state, and a `toolkit gh api` command for the original surface.
Omitting PR infers the current branch; `--all` includes resolved/outdated items.
`resolve` and `harvest` retain the existing provider finding handles.
`toolkit pr asset <PR> <file|dir...> [--markdown]` uploads
the lightest useful review artifact to `public.sjer.red`; directories require
a root `index.html`, and asciinema `.cast` files get a self-contained player.

### Deployment and browser acceptance

`toolkit deployed [SELECTOR]` traces a commit through merge, image publication,
release selection, ArgoCD sync, and the running pod digest. Selectors include a
service (`scout`), variant (`scout/prod`), or commit. Use `--json`,
`--no-github`, or `--no-cluster` when needed. Deployable services, their
aliases, and variants come from the `@shepherdjerred/ops-model` service catalog,
and reports (including the `service` field of `--json`) name each service by
its catalog id, for example `temporal` or `static-sites`; the older names
`temporal-worker` and `caddy-s3proxy` still work as selectors.

Applications annotated with `delivery.shepherdjerred.com/environment` use
PostgreSQL artifact provenance for the selected release. `--delivery` also
queries this evidence explicitly, including with `--no-cluster`. The report
keeps desired, observed, accepted, and live pod digests separate; `SELECTED`
means the commit is selected but its runtime digest is unconfirmed. Delegated
applications report `UNKNOWN` when Delivery cannot be read or its environment
does not match the Argo ownership annotation. Historical Git pins cannot
substitute for that evidence.

`toolkit screenshot <package> [route]` starts a registered package on its fixed
development port and drives a PinchTab-controlled browser. It fails if the port
is already occupied rather than capturing an unrelated process.

For credential-separated captures, run `toolkit screenshot-server <package>` in
one container and pass its URL to `toolkit screenshot <package> [route]
--base-url <url>` from a separate container. The server container never receives
PinchTab credentials or config.

### Operations and local history

- `toolkit alerts list|show` queries the durable alert occurrence ledger.
- `toolkit ops summary [--json] [--needs-me] [--section ID]` reads the homelab
  ops snapshot, applies the staleness policy, and prints overall severity, one
  line per section, what is waiting on you, and the top attention signals with
  their first link. A non-200 response, unreachable dashboard, or snapshot that
  breaks the `@shepherdjerred/ops-model` contract exits nonzero.
- `toolkit bugsink ...` queries teams, projects, issues, events, stacktraces,
  and releases in self-hosted Bugsink.
- `toolkit discord ...` operates the private local Discord session daemon.
- `toolkit mc ...` drives disposable Minecraft sandboxes through the
  mc-harness daemon. See [Minecraft sandboxes](#minecraft-sandboxes).
- `toolkit history ...` searches the private, rebuildable local agent-history
  index. It never treats prior conversation as current deployment truth.

#### Minecraft sandboxes

`toolkit mc` is a thin client for the `@shepherdjerred/mc-harness` daemon. The
daemon runs from the monorepo checkout (`bun run
packages/mc-harness/src/daemon/main.ts`), needs Docker, and stages the
repo-built MCBridge plugin, so build it first:

```bash
mise exec -- gradle -p packages/the-storm/plugin :bridge:assemble
toolkit mc daemon start [--ttl 4h]
toolkit mc sandbox up [--profile paper] [--provider docker|kubernetes] [--world flat|void] [--ttl 2h] [--keep]
toolkit mc info
toolkit mc we --world world --pos1 0,-60,0 --pos2 4,-56,4 "//set stone"
toolkit mc region read --world world 0,-60,0 4,-56,4
toolkit mc we-undo
toolkit mc sandbox down --all
toolkit mc daemon stop
```

A sandbox is Paper 26.2 with WorldEdit and MCBridge in a local container, or
with `--provider kubernetes` (the default for the `storm-prod` and
`storm-candidate` profiles) a pod in the cluster's `mc-sandbox` namespace
reached through `kubectl port-forward`. Its
game, RCON, and bridge ports are published on `127.0.0.1` only; the bridge
token and RCON password live in `~/.toolkit/mc/sandboxes/<id>/record.json`
(mode `0600`) and never appear in command output. `--target <id>` selects a
sandbox; without it the command uses the only running one and fails when there
are none or several. A sandbox is removed when its TTL expires or the daemon
stops, unless it was created with `--keep`. There is no live-server target yet.

Coordinates may be negative anywhere (`--pos1 -3,-60,-3`, `region read
-6,-61,-6 6,-44,6`, `cmd tp agent -60 0`); no `--opt=` or `--` is needed.
`toolkit mc <command> --help` prints that command's usage. Each `we` op reports
`changed N`, the blocks whose state really changed; WorldEdit's own "blocks
affected" message counts attempted sets and can be higher.

| Command                                                                                    | Purpose                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `mc cmd <command…>`                                                                        | Console command with captured feedback                        |
| `mc we --world w [--pos1] [--pos2] [--at] "//cmd"`                                         | WorldEdit as the `agent:<session>` actor                      |
| `mc we-undo [--steps n]`                                                                   | Undo that session's WorldEdit history                         |
| `mc paste --world w --file f.schem --at x,y,z [--rotate]`                                  | Paste a Sponge schematic through WorldEdit                    |
| `mc region read --world w <a> <b> [--out f.json]`                                          | Exact block states and palette counts                         |
| `mc snapshot create\|ls\|get\|restore`                                                     | Server-side `.schem` snapshots for undo                       |
| `mc info`, `mc players`, `mc events`, `mc logs`                                            | Versions, players, bridge events, console tail                |
| `mc registry --out f.json`                                                                 | Block registry (input to mc-build's registry)                 |
| `mc actor spawn\|ls\|observe\|act\|quit`                                                   | Citizens test actors (paper, storm-dev)                       |
| `mc playtest run <file\|dir…> [--profile] [--target]`                                      | Run scenario files; reports under `runs/`                     |
| `mc playtest ls\|show <run-id>\|new <name>`                                                | Past runs, one report, scaffold a scenario                    |
| `mc evidence search [--player] [--text] [--surface] [--since ISO] [--until ISO] [--limit]` | Search The Storm's private evidence archive                   |
| `mc evidence show <submission-uuid>`                                                       | Complete submission and event trail                           |
| `mc evidence export --output private.jsonl [same filters]`                                 | Paginated owner-only JSONL export; existing files are refused |

Evidence commands accept `--target <sandbox-id|live>` and require a running The
Storm safety service behind authenticated MCBridge. Search and show return private
JSON; export prints only its file path and count. Every query is audited. Export
fixes its upper timestamp before pagination, includes submission/event records, and
begins with a manifest naming the target, time bounds and query digest. It
creates files with mode `0600`. Private results never pass through Minecraft console
or RCON output. A failed export leaves a partial file that must be kept private.

Every command accepts `--json`. The daemon logs requests (never secrets) to
`~/.toolkit/mc/logs/`. `cmd`, `we` and `paste` accept `--record <buildDir>` to
append the op to a build's op log once it succeeds. Recorded writes hold the
build's publication lock from the server mutation through recording, excluding
render snapshots; a busy or missing build fails before the server write.
Recorded pastes retain the exact schematic bytes sent to the server.

#### Minecraft builds

`toolkit mc build …` runs the mc-harness build CLI from the checkout (it needs
the `@shepherdjerred/mc-build` registry, renderer and compile child, which stay
out of the compiled binary). A build directory holds `build.json`, the op log,
the captured site and renders; the repository `minecraft-building` skill
(`.agents/skills/minecraft-building`) describes the loop.

```bash
toolkit mc build init ./cottage --name cottage --world world --anchor 26,-60,26
toolkit mc build capture ./cottage --target <id> --world world 20,-61,20 40,-45,40
toolkit mc build canvas ./cottage                # void sandbox seeded with the site
toolkit mc build compile ./cottage               # build.ts → schematic paste op + lint
toolkit mc build import ./cottage house.litematic --at 26,-60,26   # .litematic/.schem
toolkit mc build import ./cottage statue.obj --height 24 --solid   # OBJ mesh → blocks
toolkit mc build run ./cottage                   # reset canvas, replay ops, freeze result
toolkit mc build render ./cottage                # contact sheet PNG
toolkit mc build replay ./cottage                # fresh sandbox, diff against the frozen result
toolkit mc build promote ./cottage --target <id> [--confirm <planHash>]
toolkit mc build undo <applyId>
```

Promote refuses when the target no longer matches the captured site, requires
the plan hash from its dry run, takes an undo snapshot, pastes the frozen
canvas result, and verifies it cell by cell. Applies are journaled under
`~/.toolkit/mc/journal/<target>/`.

#### History search

`history` maintains a private local index of Conductor, Claude Code, Codex,
Cursor, bundled OpenCode, standalone OpenCode, Antigravity, and Grok CLI
conversations. Install the macOS LaunchAgent once; search itself only reads
the index and never performs live service checks.

| Command                                                                      | Description                                   |
| ---------------------------------------------------------------------------- | --------------------------------------------- |
| `history search <QUERY> [--since 7d] [--source NAME] [--limit N]`            | Rank indexed work with BM25                   |
| `history search <QUERY> --include-excerpts`                                  | Add targeted 360-character source excerpts    |
| `history recent [--since 7d] [--limit N]`                                    | List recent indexed sessions                  |
| `history show <ID> [--query TEXT] [--messages 8] [--include-tools] [--json]` | Read bounded, role-aware conversation context |
| `history sources [--json]`                                                   | Show source availability and scan errors      |
| `history usage [--since 7d] [--source NAME] [--json]`                        | Token counts and estimated cost by source     |
| `history daemon install`                                                     | Install and start the macOS LaunchAgent       |
| `history daemon status\|reindex`                                             | Inspect or refresh ingestion                  |
| `history daemon stop\|start\|uninstall`                                      | Manage the LaunchAgent lifecycle              |

```bash
toolkit history daemon install
toolkit history recent --since 7d
toolkit history search "argocd prune" --since 90d
toolkit history show <ID_FROM_SEARCH> --query "argocd prune"
toolkit history sources
toolkit history usage --since 30d
toolkit history usage --since all
```

`--since` accepts `7d`/`24h`/`1w`, an ISO date, or `all` for no lower bound;
omitting it defaults to the last 7 days on every `history` subcommand.

Search ranks title, dialogue, and tool text separately and uses recency only to
break relevance ties. Unquoted terms keep AND-prefix behavior; pass literal
quotes inside the query for an exact phrase, for example
`toolkit history search '"Bryan Bucks"'`. The current Conductor/Codex run and
30-minute parallel duplicates are hidden/grouped by default; use
`--include-current` or `--include-duplicates` when needed. Source failures are
warnings on stderr, or in the JSON `warnings` array.

JSON search and recent output are envelopes (`{ query, results, warnings }` and
`{ results, warnings }`). `show --json` returns
`{ record, messages, truncated }`. Local index IDs can change after a rebuild;
rerun search when an ID is missing.

The rebuildable index is `~/.toolkit/history/index.sqlite`; daemon state,
socket, and logs are in that private directory. The LaunchAgent is
`~/Library/LaunchAgents/com.jerred.toolkit-history.plist`. Transcript bodies
are not copied into ordinary index tables. `show` returns at most eight
messages and 6,000 characters by default, excluding system, reasoning, and
compaction records. Standalone OpenCode's
`~/.local/share/opencode/auth.json` is never read or indexed. Use `deployed`,
`pr health`, or the relevant live client to verify current status after using
history for context.

Antigravity's local conversation databases carry no reconstructible transcript
text (only usage telemetry), so its indexed dialogue is minimal by design —
its value here is the token/cost data, not search.

##### Token and cost tracking

`history usage` reports token counts and an estimated USD cost per source,
populated for the sources whose local data actually carries usage
(Claude Code, Codex, Antigravity, Grok — Cursor, Conductor, and OpenCode
don't appear in the report at all today, since their local data doesn't
reliably carry usage). Cost comes from whichever source is authoritative:
Grok CLI self-reports its own per-turn cost (`costUsdTicks`), which is used
directly; every other source is priced against the shared
`@shepherdjerred/llm-models` catalog. A session using a model the catalog
doesn't price reports its real token counts with `cost_complete: false` and
a null cost — never a fabricated `$0`. These are local estimates for
personal visibility, not authoritative billing.

Usage is tracked per turn/generation, each tagged with when it actually
happened, not as one lifetime total per session — so `--since` filters to
activity within the requested window even for a session that spans the
window boundary, instead of attributing its entire history to whichever
window its most recent message falls in. Codex's `cached_input_tokens` is
priced as a subset already included in its input tokens (OpenAI's cache
discount), distinct from the additive cache-read/cache-write tokens Claude
Code and Antigravity's Claude-backed sessions report.

##### Usage metrics push

When `historyMetricsPushEnabled` is on, the history daemon pushes AI usage and
Brim quota metrics over OTLP/HTTP every 60 seconds to the homelab Alloy
gateway (`otlp-metrics` on the tailnet), which remote-writes them into
Prometheus. It is off by default; enable it in `~/.toolkit/config.toml` and
restart the daemon (`toolkit history daemon stop && toolkit history daemon start`):

```toml
[history.metrics.push]
enabled = true
```

Pushed series are `ai_usage_tokens_total{source,model,type}`,
`ai_usage_cost_usd_total{source,model}`, `ai_usage_events_total{source,model}`,
`ai_usage_unpriced_events_total{source}`,
`ai_subscription_quota_used_ratio{provider,window_id,window_kind}`,
`ai_subscription_quota_reset_timestamp_seconds{provider,window_id}`, and
`ai_subscription_snapshot_timestamp_seconds{provider}`, with
`job="toolkit-history"` and `instance=<hostname>`. Prompts, paths, workspaces,
and session ids never leave the machine.

Because the history index is rebuildable, usage totals come from a separate
ledger, `~/.toolkit/history/usage-export.sqlite`. It remembers a SHA-256 key per
event, so pruning a transcript, reindexing, or restarting the daemon never
lowers or double-counts a total. The first run records existing events without
counting them: enabling the push never backfills history, and events that
predate that seed never count later either. Keys older than 400 days are
pruned. Deleting the ledger restarts the counters from zero. A missing Brim
cache skips quota metrics; a corrupt one is logged as a refresh failure in the
daemon log each scan until Brim rewrites it.

Run `toolkit --help` or a workflow’s `--help` for the complete command surface.

## Credentials

Run supported toolkit commands directly; they resolve their registered
credentials before dispatch. Each credential uses the first available source:

1. A non-empty environment variable.
2. Its entry in `~/.toolkit/config.toml` under `[credentials]`, containing an
   `op://` reference or `keychain:<service>` locator.
3. Its registered backend below.

Native passthroughs invoked with exactly `--help`, `-h`, or `--version`, plus
the exact invocation `toolkit argocd version --client`, run without credential
resolution. ArgoCD also supports a bare subcommand path ending in `--help` or
`-h`, such as `toolkit argocd app rollback --help`, and the equivalent
`toolkit argocd help app rollback` form (including root `argocd help`). The help
subcommand remains credential-free with global options and `--` operands;
option values and application names equal to `help` retain authentication.
Inherited options are recognized before, within and after the command path,
including after the help flag. Repeated help booleans retain native ordering.
Their arguments, native output, and exit status are preserved.
These ArgoCD invocations also remove `ARGOCD_AUTH_TOKEN` from the child
environment because native help prints its default value. Server commands
continue to inherit the configured token.
Other invocations still resolve credentials, including `argocd version` and
commands carrying metadata flags as arguments or after `--`.

Every ArgoCD invocation sets an empty native `--auth-token` help default through
`ARGOCD_OPTS`. The API client still reads `ARGOCD_AUTH_TOKEN`, and explicit
command-line flags retain precedence. Native help and usage therefore cannot
print the registered environment token. Streams remain inherited, preserving
terminal detection, confirmation prompts, exit codes and signals.
`ARGOCD_OPTS` must not set `--auth-token`: use `ARGOCD_AUTH_TOKEN` for that
credential instead. Other `ARGOCD_OPTS` settings are preserved. Toolkit rejects
the unsafe setting without printing its value, including for help commands.
Option names are checked after ArgoCD-compatible quote and escape parsing;
header values and root paths containing the same text are preserved.

| Commands                                                                                      | Registered backend        |
| --------------------------------------------------------------------------------------------- | ------------------------- |
| `woodpecker`, `pr`, `posthog`, `cf`, `argocd`, `grafana`, `prom`, `loki`, `tempo`, `temporal` | 1Password service account |
| `bugsink`, `discord`                                                                          | macOS Keychain            |

The registry in `src/lib/credentials.ts` owns the variable names and secret
locators. Backend failures are errors; a missing Keychain secret does not
automatically fall through to 1Password. A config override selects a different
backend explicitly. Toolkit logs credential names and backends, never values.
The native Temporal CLI performs authentication, while toolkit supplies its
`TEMPORAL_API_KEY` for external addresses. Toolkit skips that credential lookup
when the effective address is the exact in-cluster service; an explicit
`--address` takes precedence over `TEMPORAL_ADDRESS` for this decision.

For the 1Password backend, `OP_SERVICE_ACCOUNT_TOKEN` wins. Otherwise, on
macOS, toolkit reads the enrolled service account from Keychain and invokes
`op` with that token. If the command reports missing enrollment, use the
repository's existing setup from its root:

```bash
swift scripts/onepassword/enroll-service-account.swift
```

Commands outside toolkit reuse the same Keychain credential by wrapping
`op run` or `op read` with `scripts/onepassword/with-service-account.sh`, so
homelab-vault references never wait for 1Password desktop approval. Packages
can also call `resolveCredentials` from `@shepherdjerred/toolkit/lib/credentials.ts`
before spawning subprocesses, as the Temporal Worker Deployment rollout does.

Outside macOS, supply `OP_SERVICE_ACCOUNT_TOKEN` through the existing secret
manager integration. For Bugsink and Discord, a missing credential error names
the exact workstation-secret enrollment command. Never paste tokens into chat,
CLI arguments, or the toolkit config file; the config stores locators only.

`ci` uses the registered `WOODPECKER_TOKEN` credential for the default
connection, unless `WOODPECKER_TOKEN` is supplied in the environment. The
credential broker can bootstrap its 1Password service account from
`OP_SERVICE_ACCOUNT_TOKEN` or the enrolled macOS Keychain credential. Custom
Woodpecker URLs or repository IDs require an explicit token. CI help and
argument validation run before credentials are resolved. GitHub access uses
`GH_TOKEN` or `gh auth token`.
Commands such as `gh`, `temporal`, and `tailscale` retain native authentication;
S3 workflows retain the AWS credential chain.

## Configuration

Toolkit behavior settings resolve `environment -> ~/.toolkit/config.toml ->
default`. An explicit value stops resolution, including `false`; an invalid
value or unparseable file is an error, not a fallback.

| Key (env / TOML path)                                             | Default                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| `HISTORY_METRICS_PUSH_ENABLED` / `history.metrics.push.enabled`   | `false`                                               |
| `HISTORY_METRICS_PUSH_ENDPOINT` / `history.metrics.push.endpoint` | `https://otlp-metrics.tailnet-1a49.ts.net/v1/metrics` |
| `OPS_DASHBOARD_URL` / `ops.dashboard.url`                         | `https://ops.tailnet-1a49.ts.net`                     |

The history daemon runs under launchd without your shell environment, so set
its keys in the TOML file. It reads them once at start.

## Environment variables

Toolkit-owned workflows use these variables. The credential broker supplies
registered token variables automatically; native authentication and AWS
profiles remain owned by their respective clients.

| Variable              | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `ALERT_DASHBOARD_URL` | Alerts service URL                          |
| `BUGSINK_URL`         | Bugsink instance URL                        |
| `BUGSINK_TOKEN`       | Bugsink API token                           |
| `AWS_PROFILE`         | AWS profile for `pr asset`                  |
| `DISCORD_BOT_TOKEN`   | Bot identity for `discord daemon start`     |
| `DISCORD_USER_TOKEN`  | Userbot identity for `discord daemon start` |

## Development

```bash
bun run typecheck
bun run lint
bun run test
bun run build
bun run test:integration
```

`src/index.ts` separates platform passthroughs from monorepo workflow routers.
The typed passthrough registry and subprocess runner live in
`src/lib/passthrough.ts`; service-specific workflow code lives under
`src/commands/` and `src/lib/`. Unix passthroughs replace the process with
`execve`; Windows starts a child with inherited console streams and returns its
exit code.
