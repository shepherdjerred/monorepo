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
toolkit deploy candidates <ENVIRONMENT_ID> --json
toolkit deploy rollback <ENVIRONMENT_ID> <DEPLOYMENT_ID>
toolkit deploy monitor <ENVIRONMENT_ID> --json
toolkit deploy workers list <ENVIRONMENT_ID> --json
toolkit deploy workers baseline --file <REVIEWED_BASELINE_JSON> --machine
toolkit deploy workers adopt --file <REVIEWED_ADOPTION_JSON> --machine
toolkit deploy workers retire <ENVIRONMENT_ID> <WORKER_ID> --request-id <REQUEST_ID>
toolkit deploy workers recover <DEPLOYMENT_ID> --machine --expected-generation <GENERATION> --reason "Inspect the exact quarantined operation independently"
toolkit deploy workers recovery <INTENT_ID> --json
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
`deploy attest --machine` resolves `DELIVERY_ATTEST_TOKEN` instead: the Delivery
service item's `DELIVERY_ATTEST_TOKEN` field, an operator identity with the
`attest` scope that the executor never holds. Delivery refuses attestations
from executor credentials.

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
Rollback names the deployment whose accepted selection it restores; it does not
restore persistent data.

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

Minecraft releases restart the retained world volume. `toolkit deploy minecraft`
is refused. Scheduled Velero backups are the only backup. An image rollback is
that same restart and does not restore an older world.

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

### Model verbs

These verbs drive the Delivery model (`packages/delivery/docs/model.md`). A
selection is one set revision, recipe revision and configuration revision;
within an environment it is named by the deployment that froze it.

```bash
toolkit deploy start <ENVIRONMENT_ID> <SET_REVISION_ID> [--override]
toolkit deploy approve <DEPLOYMENT_ID> --override --reason "Reviewed the ineligible set revision"
toolkit deploy promote <SOURCE_ENVIRONMENT_ID> <DESTINATION_ENVIRONMENT_ID>
toolkit deploy candidates <ENVIRONMENT_ID>
toolkit deploy rollback <ENVIRONMENT_ID> <DEPLOYMENT_ID>
toolkit deploy rebind <ENVIRONMENT_ID> --recipe <RECIPE_REVISION> --configuration <CONFIGURATION_REVISION>
toolkit deploy monitor <ENVIRONMENT_ID>
toolkit deploy retire <SERVICE_ID> --reason "Replaced by Arcade" --machine
toolkit deploy catalog reconcile [--file <CATALOG_DOCUMENT_JSON>] --machine
toolkit deploy attest <DEPLOYMENT_ID> --stage <STAGE> --evidence <EVIDENCE_JSON> --machine
toolkit deploy approve-plan <DEPLOYMENT_ID> --reason "Reviewed the saved plan's changes"
toolkit deploy reject-plan <DEPLOYMENT_ID> --reason "Why the saved plan must not apply"
toolkit deploy recover <DEPLOYMENT_ID> --expected-generation <N> --reason "Inspect the target and settle ownership" [--step <STEP>] [--operation-id <ARGO_OPERATION_UUID>] --machine
toolkit deploy recovery <INTENT_ID>
toolkit deploy recovery --pending
toolkit deploy recovery <INTENT_ID> --abandon --reason "Why nothing needs this intent" --machine
```

`start` requests an exact set revision the way the recipe the release
freezes realises it: `deploy`, or `channel-publish` and `operator-run` for
those recipe kinds. A release freezes the environment's declared recipe and
configuration, so a registered catalog change ships with it; `rebind` applies
one to the accepted set revision alone. It takes that kind
from the environment detail's `releaseKind`, which reads the stored kind as
admission does, so a v1 `manual` pipeline is a `deploy` although the
selection view names it `operator-run`. `--override` asks for the approval a non-eligible `deploy`
needs, such as a set revision never accepted in the promotion source;
`approve --override` and `reject --override` decide it. `promote` takes the source's accepted selection and names no set
revision. `candidates` lists accepted selections, newest first, and states why
each excluded one would lower a forward-only configuration key or cross a
point-of-no-return step; the accepted one can be re-asserted. `rollback` reads that list and refuses an excluded or
unknown deployment with the server's reason before it sends anything. `rebind`
keeps the accepted set revision and moves to the named recipe or configuration
revision; it names at least one. These requests read the environment's binding
generation unless `--expected-generation` pins it. `monitor` prints the accepted
deployment's monitor: state, policy, the declared evidence thresholds and the
latest observation with its firing alarms.

`retire`, `catalog reconcile` and `recover` require the admin credential. `catalog reconcile` reads the
catalog document `--file` names, or without `--file` builds the committed one
of the monorepo checkout it runs in with `loadCatalogDocument()` from
`@shepherdjerred/ops-model/delivery-catalog/files.ts`, reading the core and
revision files from that checkout. It validates the document
against the catalog contract, prints its catalog revision before sending, and
exits 1 when the server refuses any entry. `recover` creates the one recovery intent of a
`recovery-required` deployment, bound to the expected binding generation and,
for a compound target, the named sub-step. With `--operation-id`, it then
settles an ordinary Argo intent by independent readback of that exact
inspected operation. `recovery` reads an intent and its inspection evidence. `recovery --pending` lists every pending intent, oldest first. With `--abandon`, it closes a pending intent whose deployment already ended without needing recovery; the server refuses while the deployment is still recovery-required, a producer barrier is unrestored, or a recovery Workflow owns the intent, and abandoning releases nothing.
`approve-plan` and `reject-plan` record the one decision on the exact saved
plan a model `tofu` recipe's approve step waits on: each reads the digest from
the deployment's saved plan and requires a human identity. A rejection
discards the plan and ends the deployment failed without applying. Once a
decision settled the approve step, a repeated command names the digest that
decision bound, so retrying after a lost response returns the same settled
decision instead of failing for want of a saved plan. `attest`
records operator-attested evidence for one stage of an `operator-run`
deployment; the evidence file is a JSON array of evidence entries, and the
command uses the attestor credential `DELIVERY_ATTEST_TOKEN`, which the
executor never holds.

`catalog reconcile` is how definitions reach Delivery. Two older verbs register
one pipeline revision or environment outside the catalog, with an admin
machine credential:

```bash
toolkit deploy pipeline register <PIPELINE_REVISION_ID> --file <DEFINITION_JSON> --machine
toolkit deploy environment register --file <ENVIRONMENT_JSON> --machine
```

Their files conform to the shared Delivery contracts. After either one,
`handover-context` refuses until the next catalog reconcile, because the
record no longer matches the reconciled catalog.

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
toolkit tracker issue create --team AI --title "Sub-task" --parent AI-26 --due 2026-12-01
toolkit tracker issue update AI-27 --parent none --due none
toolkit tracker issue bulk-update AI-27 AI-28 SJ-4 --state started --add-label agent
toolkit tracker issue list --team AI --parent AI-26 --sort due
toolkit tracker issue list --team AI --overdue --due-after 2026-01-01
toolkit tracker view create --name "My work" --icon inbox --input-json '{"states":["started"],"sort":"due"}'
toolkit tracker view list --team AI
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

Codex uses `CODEX_THREAD_ID` directly. Grok uses `GROK_SESSION_ID` directly;
`GROK_AGENT` still fails closed when that session id is missing. The dotfiles
install a Claude SessionStart hook through `CLAUDE_ENV_FILE` and a Cursor Shell
`preToolUse` hook through `updated_input`.
They forward the native session ID and select the child harness when another
harness launched it. An earlier session id wins when several are set, unless
`TRACKER_ACTOR_HARNESS` names the child.
Claude model detection reads only the transcript explicitly provided by that
session's hook. Missing session identity fails with an actionable error.
Install the compiled toolkit before activating these hooks; existing sessions
need a restart or their explicit native session environment.

`--parent` makes an issue a sub-issue of another issue in the same team, up to
five levels deep; `issue view` shows the parent and the sub-issues. Due dates
are calendar days (`YYYY-MM-DD`) with no time zone. `--overdue` matches issues
due before `--today`, which defaults to this machine's local date, whatever
their state; combine it with `--state` to exclude finished work. A saved view
stores issue-list parameters as JSON keyed like the `issues.list` input, plus
the display keys `group` and `view`.

`issue bulk-update <ID...>` applies one patch to up to 250 issues in one
transaction: every issue changes or none does. It takes the `issue update`
patch flags except `--title`, `--description` and `--expected-revision`, and
passes `--state` through so each issue's team resolves its own state.

`tracker api <procedure> --input-json '<JSON>'` is the query escape hatch;
`--mutation` adds the same validated actor. Additional catalog mutations use
this API. `tracker --help` lists the complete command tree.

## Platform commands

Platform commands delegate to native CLIs. Explicit flags and environment
values override the monorepo defaults.

| Command      | Native CLI       | Monorepo default                                     |
| ------------ | ---------------- | ---------------------------------------------------- |
| `gh`         | `gh`             | `GH_REPO=shepherdjerred/monorepo`                    |
| `woodpecker` | `woodpecker-cli` | Woodpecker CI; server and token from the environment |
| `git-spice`  | `git-spice`      | Current checkout                                     |
| `posthog`    | `posthog-cli`    | Project `549883`                                     |
| `grafana`    | `gcx`            | Homelab Grafana, brokered token                      |
| `prom`       | `gcx metrics`    | Homelab Grafana, brokered token                      |
| `loki`       | `gcx logs`       | Homelab Grafana, brokered token                      |
| `tempo`      | `gcx traces`     | Homelab Grafana, brokered token                      |
| `temporal`   | `temporal`       | `--profile homelab`                                  |
| `argocd`     | `argocd`         | Homelab server and `--grpc-web`                      |
| `cf`         | `cf`             | Native configured context                            |
| `tailscale`  | `tailscale`      | Native local daemon                                  |
| `talosctl`   | `talosctl`       | Homelab `os:admin` talosconfig on `/dev/fd/3`        |

The gcx commands set gcx's own server, org, and token runtime overrides (the
token from the brokered `GRAFANA_API_KEY`), so no context or token is written
to gcx's config. An explicit `--context` keeps
that context's server.

`talosctl` has no credential plugin. Toolkit builds the talosconfig from the
brokered `TALOS_CA`, `TALOS_CRT`, and `TALOS_KEY` and hands it over an
anonymous pipe; nothing is written to disk. It refuses `config`, `kubeconfig`,
`gen`, and `cluster`, which write talosconfigs, kubeconfigs, or secrets. An
explicit `--talosconfig` or `TALOSCONFIG` runs talosctl unchanged without
brokered credentials. `--help` and `version --client` need no credentials.

Toolkit looks up native binaries on `PATH` minus relative entries,
`node_modules` bin directories, and the shim directory
`~/.local/share/toolkit/shims`, so a dependency's same-named binary never
receives brokered credentials and a shim never calls toolkit again. No
passthrough child inherits `OP_SERVICE_ACCOUNT_TOKEN`.

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
`promtool`, and `logcli` stays directly invoked. On a workstation, `kubectl`
and `aws` get credentials through the helpers below rather than a passthrough.

### Credential helpers

These commands broker credentials for tools that have their own credential
hook, so the tool's config file holds only endpoints and the helper command.

```bash
toolkit kube credential               # kubectl exec plugin (admin@torvalds)
toolkit aws credential <PROFILE>      # AWS credential_process
toolkit run --env NAME[,NAME] -- CMD  # one command with named credentials
toolkit credentials flush [NAME...]   # drop cached 1Password reads
toolkit credentials references --json # effective op:// locators; no secret reads
```

- `kube credential` prints a `client.authentication.k8s.io/v1`
  `ExecCredential` with the homelab admin client certificate, valid for one
  hour. It runs only when client-go sets `KUBERNETES_EXEC_INFO`, so it cannot
  print the key into a terminal or transcript by hand.
- `aws credential` serves the `seaweedfs`, `brim-sync`, `b2-velero`,
  `b2-postgres-wal`, and `b2-seaweedfs-backups` profiles. It refuses a
  terminal on stdout. The Backblaze keys are bucket-scoped, so list a bucket
  (`aws --profile b2-velero s3 ls s3://sjerred-velero/`), not all buckets.
- `run` resolves the named registry credentials (or `[credentials]`
  overrides) and starts the command with them in its environment only. It
  replaces `with-service-account.sh op run`, whose child also inherits the
  service-account token. Signals are forwarded and the exit status mirrored.
- `credentials flush` removes cached reads after a rotation. Without names it
  flushes every registered credential.
- `credentials references --json` inventories effective 1Password locators from
  the evaluated registry and local overrides without resolving their values.
  Environment values and Keychain-backed credentials are excluded.

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
toolkit ci wait --main --json           # Main's tip: wait for its own verifying run
toolkit ci wait --main --head <SHA>     # One main commit, e.g. a merge commit
toolkit ci wait --main --follow         # Follow new main commits until the tip passes
toolkit pr land 3447 --json             # Wait for readiness, then squash-merge
toolkit ci explain 3447                # Current blockers and bounded failure logs
toolkit ci main                        # Current main verification and last completed verdict
toolkit ci load                        # Queue, compute/gate admission, CPU/memory/disk/I/O
toolkit ci timings --since 72h --json   # Recent timing cohorts and per-workflow phases
toolkit ci analyze --since 72h           # Uncached work, critical path, repeated misses, hot files
toolkit ci analyze --suites --compare 4300  # Slowest test suites of the newest run; deltas from pipeline 4300
toolkit pr review list 3447 --json      # Human and provider feedback with full bodies
```

CI commands resolve `WOODPECKER_TOKEN` through the registered credential broker,
as the native Woodpecker command does. An explicit token retains precedence;
custom server URLs or repository IDs require an explicit token.

`toolkit ci analyze` reads each finished ready-PR and main pipeline's verify
Turbo diagnostics from `ci-handoff` (profile `seaweedfs`, or `--profile`) and
compacts them under `~/.cache/toolkit/ci-analyze`. It ranks executed tasks by
total seconds, names the task each run finished on, and finds misses whose own
inputs an earlier run had already executed, which points at `dependsOn` fan-out
or cache isolation. Its hot-file table runs `turbo run --dry=json` over
verify's task list in the current checkout. Each file's commits on `--ref`
(default `origin/main`) over `--churn-days` are multiplied by the median miss
cost of every task hash the file reaches, directly or through `dependsOn`.
`--no-hot-files` skips the local graph. Costs come from task IDs seen in the
window, so a renamed task counts as free until new runs record it.

`toolkit ci analyze --suites` explains a slow test task by the files inside
it. Verify diagnostics carry the `<testsuite>` summaries (name, seconds, tests,
failures) of every JUnit report under `.ci-reports/junit`, which
`scripts/lib/ci/test-timings.ts` collects best-effort after the task; the
nightly `verify-extended` run and local `test:extended` runs leave the same
reports, so their suites compare like-for-like. By default it prints the
slowest suites of the newest finished ready-PR or main pipeline in `--since`;
`--pipeline N` names one instead (a nightly `verify-extended` pipeline's
diagnostics are read when it has no verify), and `--compare N` prints the largest
per-suite changes from pipeline N to that run, followed by a count of the
suites only one of them executed. A suite is listed only when its test task
ran: `test:ci` declares no Turbo outputs, so a cache hit restores no report
and the suite shows `-` on that side. Diagnostics from before per-suite
collection existed are refused rather than read as "no suites".

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

A red main never ends a PR wait early. The wait keeps running while the PR's
own pipeline, required checks, or merge metadata are pending. A PR failure,
conflict, or human blocker is still reported first. Exit 5 means the PR itself
is ready while main is red. Main pushes wake the wait, so a ready PR waiting on
main notices main's recovery promptly.

`wait --main` waits for main's own verifying run of one commit: the tip when the
wait starts, or `--head <full SHA>`. The commit must be main's tip or one of its
ancestors. Push runs and full manual recoveries count; partial manual jobs do
not. It exits 0 when that run passes and 1 with bounded failure logs when it
fails. If main has moved on, the report says so but still judges the pinned
commit. `--until` does not apply. `--follow` instead re-reads main's tip on
every poll and keeps waiting through failed commits. It returns only when the
current tip's own run passes, which makes it the wait for "until main is
fixed". It cannot be combined with `--head`.

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
alias for `ci main`. To wait for main itself, use `ci wait --main`.

| Wait exit | Meaning                                                         |
| --------- | --------------------------------------------------------------- |
| 0         | Merge ready (`--main`: the pinned main run passed)              |
| 1         | Blocking check failure or merge conflict (`--main`: run failed) |
| 2         | Usage, authentication, API, or contract error                   |
| 3         | Human intervention (review, draft, pipeline approval)           |
| 4         | PR head changed; explicitly start a new wait for the new head   |
| 5         | PR ready but main red; fix main only when explicitly told       |
| 6         | Requested timeout; this does not mean CI failed                 |
| 7         | PR closed or already merged                                     |

`--json` reserves stdout for one final JSON report. Failure reports include up
to three failed workflows with at most 60 lines / 4,000 characters of logs
each, review excerpts when relevant, and commands for deeper evidence.
Secrets and terminal control sequences are removed before truncation.
`explain` is a one-shot diagnostic; a pending report exits 0 and has
`ready: false`. SIGINT and SIGTERM cancel the foreground wait with exits 130
and 143. The command does not merge or mutate the PR.

### Wait, then merge

`toolkit pr land [PR] [--head <SHA>] [--timeout <duration>] [--allow-red-main] [--json]`
merges, so run it only when the task authorizes merging. It runs the same
pinned wait as `ci wait`, but treats a red main as a reason to keep waiting
rather than a result. `--allow-red-main` merges while main is red. When the PR
is ready, it rechecks the head and runs
`git-spice branch merge --method squash --ready-timeout 0 --branch <head>`.
git-spice output goes to stderr, so `--json` keeps stdout for one report. The
report includes `mergeCommitSha` and a `ci wait --main --head` command for the
merge commit.

| Land exit | Meaning                                                         |
| --------- | --------------------------------------------------------------- |
| 0         | Merged, confirmed on GitHub                                     |
| 1–4, 6, 7 | As for `ci wait`; nothing was merged. Fix, push, run land again |
| 8         | Ready, but `git-spice branch merge` failed or did not merge     |

Run `pr land` from a checkout where git-spice tracks the PR branch. To get a PR
green and then merge, run `pr land`, fix whatever it reports, push, and run it
again.

### Holding a wait from an agent

These waits stay quiet until there is a result. When toolkit detects an agent
harness, it prints one stderr line naming that harness's cheapest way to hold
the process. Claude Code should run the command with `run_in_background` and
act on the completion notification. Codex gets no completion notice, so it
should hold the session inside one `exec` cell (pragma `yield_time_ms` 3600000) that loops an empty `write_stdin` until the command exits. Measured on
codex-cli 0.167.0, a 25-minute wait held this way cost two model turns in total,
the same as a 7-minute one.

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
uses the configured `kubectl` context and the same Grafana server and
brokered token as `toolkit prom`.

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
a root `index.html`. An asciinema `.cast` file also uploads a self-contained
player page (`<name>.cast.html`, the printed URL) and a GIF preview
(`<name>.cast.gif`) rendered locally with
[`agg`](https://docs.asciinema.org/manual/agg/); `--markdown` emits the GIF
inline, linked to the player, because GitHub cannot embed the player. `agg`
is required (`brew install agg`): if it is missing or fails, the command exits
1 before uploading anything.

### Deployment and browser acceptance

`toolkit deployed [SELECTOR]` traces a commit through merge, image publication,
release selection, ArgoCD sync, and the running pod digest. Selectors include a
service (`scout`), variant (`scout/prod`), or commit. Use `--json`,
`--no-github`, or `--no-cluster` when needed. Deployable services, their
aliases, and variants come from the `@shepherdjerred/ops-model` service catalog,
and reports (including the `service` field of `--json`) name each service by
its catalog id, for example `temporal` or `static-sites`; the older names
`temporal-worker` and `caddy-s3proxy` still work as selectors.

Catalog-delegated applications and applications annotated with
`delivery.shepherdjerred.com/environment` automatically use PostgreSQL artifact
provenance for the selected release, including with `--no-cluster` or when
ArgoCD is unavailable. `--delivery` explicitly requests this evidence for other
targets. The report
keeps desired, observed, accepted, and live pod digests separate; `SELECTED`
means the commit is selected but its runtime digest is unconfirmed. Delegated
applications report `UNKNOWN` when Delivery cannot be read, its environment is
missing, or it differs from the catalog delegation or Argo ownership annotation.
Historical Git pins cannot
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
  and releases in self-hosted Bugsink. `issues` lists unresolved, unmuted
  issues across every project unless `--project` narrows it; `--all` includes
  resolved and muted issues. `issues` and `events` accept `--limit` and
  `--max-pages`. The canonical API is read-only.
- `toolkit discord ...` operates the private local Discord session daemon.
  `TOOLKIT_DISCORD_DIR` selects an isolated daemon directory and socket.
  `discord daemon start --password-login` uses parent-injected
  `DISCORD_USER_EMAIL` and `DISCORD_USER_PASSWORD` for a user-only session,
  ignores the default bot/user tokens, and never reads desktop 1Password.
  An optional parent-generated `DISCORD_USER_OTP_CODE` completes one TOTP login
  challenge; the daemon never receives the authenticator seed or recovery codes.
  Login and MFA share the Discord SDK's authentication transport and client context.
  `discord daemon start --user-only` resolves only the registered user token
  and leaves the bot token unloaded. These login modes are mutually exclusive.
  Channel metadata includes effective `canManageMessages` for confirmation-cleanup
  preflight, including `moderationMfaLevel` and `accountMfaEnabled` when the server
  requires moderator 2FA. Exact-message deletion still verifies guild, channel, author, and
  message identity and reads back absence.
  `/edit-own-message` corrects one existing user-authored message with explicit
  guild, channel, message and author pins. It verifies ownership before editing
  and fetches the message again to require exact requested content. It never
  creates a replacement message or repeats an ambiguous edit.
  Credentials are exchanged in memory and removed from the daemon environment;
  interactive verification fails explicitly. The daemon child never inherits
  vault and inference credentials. `/channel?channelId=...` provides native user
  guild/channel permissions for scoped preview adapters.
  Internal `POST /read` accepts an optional numeric `messageId` for a fresh
  exact-message fetch in the selected channel, independent of recent history.
  The internal `POST /delete-reply` endpoint removes one explicitly authorized
  bot reply, requiring exact guild, channel, message and expected author IDs.
  It checks identity before deleting and confirms remote absence afterward;
  already absent messages require no write. Permission failures remain explicit.
  Userbot sends and slash invocations return HTTP 429 with
  `code: "DISCORD_COOLDOWN"`, `effect: "not-sent"`, `retryAfterMs` and
  `nextEligibleAt` only when the SDK rejects the matching initial mutation.
  Readback failures and unclassified errors never establish non-publication.
  The 3.7.1 SDK patch owns both the slash POST and reply promises, preventing a
  rejected POST from escaping as an unhandled background operation. It also
  preserves the longer `Retry-After` deadline for a channel sublimit. Remove it
  when upstream passes the native rejection, sublimit and fast-reply regressions.
  `/commands?channelId=...` reads the guild application-command index without
  invoking commands, including native default permission bits and per-user
  application/command permission metadata; failed lookups propagate as errors.
- `toolkit mc ...` drives disposable Minecraft sandboxes through the
  mc-harness daemon. See [Minecraft sandboxes](#minecraft-sandboxes).
- `toolkit promotion <status|preview|run|pause|resume|reconcile> [TARGET] [--json] [--dry-run]`
  operates The Storm's promotion tasks in production Temporal. `preview`, `run`
  and `reconcile` require an exact target ID; other actions may omit it for all
  destinations. Previews cannot publish; budgeted CAPTCHA solving may prepare access. Manual
  runs retain posting limits and buffers; reconciliation never submits again.
  `--dry-run` prints the native invocation without starting a Workflow. See the
  [promotion task reference](../temporal/README.md#the-storm-promotion-task) for
  target inventory, ownership, credentials and activation requirements.
- `toolkit history ...` searches the private, rebuildable local agent-history
  index. It never treats prior conversation as current deployment truth.

#### Minecraft sandboxes

For an authenticated production client, sign in to Prism Launcher on macOS,
start the Minecraft daemon with its live bridge credential, and use
`toolkit mc client start --target live --reason "<why>"`. Production movement
and hotbar changes require a reason; interactions are disabled on live clients.
See the [mc-harness client reference](../mc-harness/README.md#real-client).

`toolkit mc` is a thin client for the `@shepherdjerred/mc-harness` daemon. The
daemon runs from the monorepo checkout (`bun run
packages/mc-harness/src/daemon/main.ts`), needs Docker, and stages the
repo-built MCBridge plugin, so build it first:

```bash
mise exec -- gradle -p packages/the-storm/plugin :bridge:assemble
toolkit mc daemon start [--ttl 4h]
toolkit mc sandbox up [--profile paper] [--provider docker|kubernetes] [--world flat|void] [--world-dir /absolute/saved/world] [--ttl 2h] [--keep]
toolkit mc info
toolkit mc we --world world --pos1 0,-60,0 --pos2 4,-56,4 "//set stone"
toolkit mc region read --world world 0,-60,0 4,-56,4
toolkit mc we-undo
toolkit mc sandbox down --all
toolkit mc daemon stop
```

For concurrent worktrees, set `TOOLKIT_MC_INSTANCE=skylands-towers` (or another
lowercase label) consistently for every command in a session. This bootstrap
setting selects a private socket, sandbox store and journal without stopping
another worktree's daemon; artifact downloads remain shared. Labels allow 1–32
lowercase letters, digits and hyphens, starting with a letter. Omit it for the
original default instance. `--world-dir` copies a native saved world into a
stopped local Docker sandbox before its first boot; it never changes the source
and is unavailable for cluster or published-image profiles.

`toolkit mc client close` closes a native client's current screen, including
the first-join welcome dialog, before ordinary movement or button interaction.

A sandbox is Paper 26.3 with WorldEdit and MCBridge in a local container, or
with `--provider kubernetes` (the default for the `storm-prod` and
`storm-candidate` profiles) a pod in the cluster's `mc-sandbox` namespace
reached through `kubectl port-forward`. Its
game, RCON, and bridge ports are published on `127.0.0.1` only; the bridge
token and RCON password live in `~/.toolkit/mc/sandboxes/<id>/record.json`
(mode `0600`) and never appear in command output. `--target <id>` selects a
sandbox; without it the command uses the only running one and fails when there
are none or several. A sandbox is removed when its TTL expires or the daemon
stops, unless it was created with `--keep`. Live operations require an explicit
`--target live` and writes require a journaled `--reason`.

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

#### Minecraft documentation capture

Documentation capture uses the same daemon:

```bash
toolkit mc client start --target live --account XiguaJerred --reason "TSMC docs capture" --json
toolkit mc capture doctor --target live
toolkit mc capture site find --target live --reason "Scout docs terrain"
toolkit mc capture run <scene.ts> --site <site.json> --target live --reason "Capture instructions"
toolkit mc capture status|stop|render|review <run-id>
toolkit mc capture suite audit tsmc [--scenario ID|--shot ID]
toolkit mc capture suite review tsmc [--scenario ID|--shot ID] [--out DIR]
toolkit mc capture recover <run-id> --target live --reason "Restore capture"
toolkit mc capture export <run-id> --docs ts-mc-docs
```

Authenticated launch uses the existing macOS Prism account and the registered
`MC_BRIDGE_TOKEN` credential. The daemon owns its temporary instance and
refuses to replace an account already online. Capture scenes checkpoint and
restore the wilderness site, inventory, and temporary plugin state. Export
accepts completed live runs only and emits sanitized public derivatives and
markup. See `packages/mc-harness/README.md` for scene APIs, bounded live
actions, rehearsal prerequisites, annotations, and failure recovery.

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
Cursor, Antigravity, and Grok CLI
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
`toolkit history search '"Match Reports"'`. The current Conductor/Codex run and
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
compaction records. Use `deployed`,
`pr health`, or the relevant live client to verify current status after using
history for context.

Antigravity's local conversation databases carry no reconstructible transcript
text (only usage telemetry), so its indexed dialogue is minimal by design —
its value here is the token/cost data, not search.

##### Read API

The daemon also serves a read-only JSON API over its socket for Brim's
Sessions window. Every endpoint is `GET`. `since` takes the CLI's `--since`
grammar, and omitting it means no lower bound.

| Endpoint                                                                | Returns                                                                      |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/v1/sessions?since&source&machine&workspace&limit&offset`              | Sessions, newest first, with branch, model, counts, and usage                |
| `/v1/search?q&since&source&machine&workspace&limit&offset`              | The same session shape, ranked by BM25                                       |
| `/v1/sessions/<id>?offset&limit`                                        | One session plus a page of full messages, with tool names                    |
| `/v1/usage?groupBy=day\|source\|model\|workspace\|machine&since&source` | Usage totals per group (`day` is the local calendar day)                     |
| `/v1/tools?since&limit`                                                 | Tool calls and the number of sessions that made them, per tool               |
| `/v1/facets`                                                            | Every machine, source, and workspace with indexed sessions, and their counts |
| `/v1/captures?session&limit&offset`                                     | Captured requests (see [Brim capture](#brim-capture))                        |
| `/v1/captures/<id>`                                                     | One captured request, rebuilt, with its new blocks                           |

`machine=local` selects this machine's own sessions; mirrored sessions carry
their `brim sync` machine id. A session's `usageEvents` of zero means its
source recorded no usage, not that it cost nothing. A `tool` message with a
`toolName` is an invocation, and one without is that invocation's output.
Bad parameters return 400 and a missing session 404, both as `{ error }`. The
contracts are the
`schemas/history-api-*.schema.json` files, with shared fixtures under
`schemas/fixtures/`; a test keeps them identical to the zod schemas in
`src/lib/history/api/schema.ts`.

```bash
curl --unix-socket ~/.toolkit/history/daemon.sock 'http://history/v1/usage?groupBy=model&since=7d'
```

##### Token and cost tracking

`history usage` reports token counts and an estimated USD cost per source,
populated for the sources whose local data actually carries usage
(Claude Code, Codex, Antigravity, Grok — Cursor and Conductor
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

##### Mirrored machines

`brim sync pull` mirrors other machines' Claude Code and Codex transcripts into
`~/.toolkit/brim-sync/mirror/`. The index scans them as the `claude-mirror` and
`codex-mirror` sources: source ids gain a `<machine>/` prefix and the agent
names the machine, so `toolkit history search --source claude-mirror` finds
them. Codex mirror documents are built from the rollout JSONL itself, because
the Codex message database stays on its own machine. `history usage` includes
mirrored tokens per source, but they never enter the usage-export ledger: the
machine that spent them already exports them.

#### Brim launch

`toolkit brim` (or the standalone `brim`) ranks Brim's quota snapshots and
starts the least-used provider:

```bash
brim [--provider <id>] [--min-5h <pct>] [--dry-run] [-- <agent args...>]
brim --json
```

Each provider maps to one agent wrapper in `~/.local/share/agent-bin`:
`claude`, `codex`, `agy`, `cursor-agent`, `grok`, `kimi`, and `muse`. The
wrappers own credential scrubbing, the agent git identity, and bypass flags;
brim adds none of its own. Brim finds them by that fixed path, never `PATH`, so
a launcher with a stale `PATH` cannot start a bare agent binary. Args after
`--` pass through verbatim without a shell. An unmapped provider or a missing
wrapper is an error, and `--dry-run` prints the resolved wrapper path and args.

#### Brim sync

The standalone `brim` binary (also `toolkit brim sync`) keeps an encrypted,
permanent archive of every machine's Claude Code and Codex transcripts in the
SeaweedFS `brim-sessions` bucket:

```bash
brim sync push            # archive new complete lines from this machine
brim sync pull [--all]    # mirror other machines (default: last 30 days)
brim sync run             # push, then pull — what the LaunchAgent runs
brim sync status [--json]
brim sync redact [--dry-run]  # purge leaked credentials, then push
brim sync install         # macOS LaunchAgent, every 5 minutes
```

Push scans `~/.claude/projects` (or `CLAUDE_CONFIG_DIR`), Codex `sessions`,
`archived_sessions` and `history.jsonl` (or `CODEX_HOME`). Transcripts only
grow, so each run uploads just the new complete lines as one segment; a file
that shrinks or whose tail changed starts a new generation. Each segment and
the per-machine manifest are zstd-compressed and age-encrypted to
`brimSyncRecipient`; object keys are opaque hashes. The manifest is the commit
point and is written last, so a crash resumes from the last commit. A file
deleted locally stays in the archive. Push needs only the public recipient;
pull, and adopting the remote manifest when `~/.toolkit/brim-sync/manifest.json`
is lost, need the `BRIM_SYNC_AGE_IDENTITY` credential. The S3 keys come from
the AWS profile's credentials file by default; with
`brim.sync.s3.credentials = "broker"` they resolve at call time through the
credential broker instead, so an agent host keeps no key file while the
profile still supplies the endpoint. A pid lock makes an
overlapping run exit 0. On Windows only `brim.exe` is built (`bun run
install:local`), and a Scheduled Task from `packages/dotfiles-windows` runs
`sync push`.

Push also overwrites leaked credentials in each segment before upload:
Anthropic, OpenAI project and Linear keys, and JWTs whose header and payload
decode to JSON. Each match must be standalone (not inside a longer base64
token) and is replaced with a same-length `REDACTED-<kind>` marker, so
archive offsets stay equal to source offsets. `brim sync redact [--dry-run]`
does the same to this machine's transcripts in place: it re-reads each match
before overwriting it, keeps file size and inode, and restores the mtime, so a
CLI still appending is unaffected. It then retires the affected archive
generations; the next `brim sync push` re-uploads those files and deletes the
old segments, and every mirror rebuilds them on its next pull. Values are never
printed. Push detects appends and truncation but not an edit deep inside a file,
which is why `redact` retires generations explicitly.

Pull writes `~/.toolkit/brim-sync/mirror/index.json`, whose contract is
[`schemas/brim-sync-mirror-index.schema.json`](schemas/brim-sync-mirror-index.schema.json).
Brim reads it to add other machines to its daily usage caption.

`brim sync redact` also redacts captured requests (see `brim capture redact`).

#### Brim capture

`brim capture` (also `toolkit brim capture`) records the raw API requests the
coding-agent CLIs send, through an observe-only local proxy. The history daemon
ingests them and serves them on `/v1/captures`. Setup, the per-CLI status, and
purging are in the
[Capture raw agent requests](../docs/wiki/src/content/docs/how-to/capture-raw-agent-requests.md)
how-to.

```bash
brim capture install | uninstall    # LaunchAgent com.jerred.brim-capture (KeepAlive)
brim capture status [--json]        # settings, proxy, CA, spool, and store
brim capture env <cli>              # shell exports the agent wrappers eval
brim capture redact [--dry-run] [--json]
brim capture run                    # the proxy in the foreground
```

| Exit               | Meaning                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `env` 0, no output | Capture is off, or `brim.capture.clis` does not list the CLI         |
| `env` 0, exports   | Proxy variables plus the CLI's CA trust variable                     |
| `env` 1            | Capture is on for the CLI but the proxy is down or the CA is missing |
| 2                  | Missing or unknown action, or extra arguments                        |

The proxy is `mitmdump` from mitmproxy, pinned in
[`src/lib/brim/capture/engine.ts`](src/lib/brim/capture/engine.ts) and run
through `uvx`, on `127.0.0.1:<brim.capture.port>`. It intercepts only the
hosts of the wrapped CLIs (`allow_hosts`) and records only their inference
routes, from the table in
[`src/lib/brim/capture/clis.ts`](src/lib/brim/capture/clis.ts). The addon,
[`capture/brim_capture.py`](capture/brim_capture.py), is embedded in the binary
and written to `~/.toolkit/brim-capture/` on start. It drops `authorization`,
`x-api-key`, `cookie`, `set-cookie`, and any header whose name contains
`token`, `key`, `secret`, or `auth` before writing, tees streamed responses
without buffering them, and never modifies a flow.

| Path under `~/.toolkit/`     | Contents                                                       |
| ---------------------------- | -------------------------------------------------------------- |
| `brim-capture/ca/`           | The capture CA (key 0600), its host list, and `bundle.pem`     |
| `brim-capture/mitmproxy/`    | mitmproxy's confdir copy of the CA                             |
| `brim-capture/spool/*.jsonl` | 0600 segments awaiting ingest; `.part` is still being written  |
| `history/captures.sqlite`    | Ingested captures; not rebuildable, kept `retention.days` days |

The CA is generated with the system `openssl` and carries a critical
`nameConstraints` extension that permits only the capture hosts. It is never
added to a keychain: each CLI trusts it through `NODE_EXTRA_CA_CERTS`,
`CODEX_CA_CERTIFICATE`, or `SSL_CERT_FILE`. `bundle.pem` is the macOS system
roots plus the CA, because `SSL_CERT_FILE` replaces a runtime's roots and is
inherited by the agent's children.

Each daemon scan parses closed spool segments, redacts each string in each
record separately with the `brim sync` patterns (so no match spans two
records or values), applies them in one transaction, and deletes them. A
streamed response is redacted again once its deltas are assembled, since a
credential split across them is whole only then. Requests are split into
blocks (system parts, tool definitions, `messages[]` or Responses `input[]`
items) stored once each by SHA-256 and zstd-compressed; unknown and protobuf
bodies are kept whole. A request that continues a server-side response (Codex
`previous_response_id`, Claude Code `thread.continue`) is rebuilt from the
captures it continues. `/v1/captures?session=<id>` links captures to a history
session by the CLI's session id (Claude `x-claude-code-session-id`, Codex
`thread-id`) and falls back to CLI, time window, and working directory for
captures without one.

In `/v1/captures/<id>`, `request` is the full rebuilt context, inherited
blocks included, and `rawRequest` is only what was sent on the wire. For a
chained request, `rawRequest` holds just the incremental input.

| Block field | Meaning                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `index`     | Position in its `request.system`, `request.tools`, or `request.messages` array, inherited blocks counted                  |
| `sentIndex` | Position in the matching `rawRequest` array (`system`/`instructions`, `tools`, `messages`/`input`); `null` when inherited |
| `inherited` | Rebuilt from the request this one continues, not sent                                                                     |
| `isNew`     | Added over `previousCaptureId`                                                                                            |

A capture with `warmup: true` asked for no output (Codex `generate: false`).
It is listed but is never a `previousCaptureId`, so the request chained from
it diffs against the last real turn. Tool definitions are one
`tool_definition` part per callable tool, with `namespace`, `description`, and
`parameters`. Codex namespaces and Gemini `functionDeclarations` are expanded.
The record contract is
[`schemas/brim-capture-flow.schema.json`](schemas/brim-capture-flow.schema.json);
the API contracts are `schemas/history-api-captures*.schema.json`. The addon's
pytest suite runs in CI as the `capture-addon` step of
[`ci-tests.json`](ci-tests.json); run that command from this directory to run
it locally.

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

| Commands                                                                                                 | Registered backend        |
| -------------------------------------------------------------------------------------------------------- | ------------------------- |
| `woodpecker`, `pr`, `posthog`, `cf`, `argocd`, `grafana`, `prom`, `loki`, `tempo`, `temporal`, `bugsink` | 1Password service account |
| `talosctl`, `kube credential`, `aws credential`, `run`                                                   | 1Password service account |
| `discord`                                                                                                | macOS Keychain            |
| `brim sync pull` (`BRIM_SYNC_AGE_IDENTITY`)                                                              | 1Password service account |
| `brim sync` in broker mode (`BRIM_SYNC_S3_ACCESS_KEY_ID`, `BRIM_SYNC_S3_SECRET_ACCESS_KEY`)              | 1Password service account |

The registry in `src/lib/credential-registry.ts` owns the variable names and
secret locators; `src/lib/credentials.ts` resolves them. Backend failures are errors; a missing Keychain secret does not
automatically fall through to 1Password. A config override selects a different
backend explicitly. Toolkit logs credential names and backends, never values.
The native Temporal CLI performs authentication, while toolkit supplies its
`TEMPORAL_API_KEY` for external addresses. Toolkit skips that credential lookup
when the effective address is the exact in-cluster service; an explicit
`--address` takes precedence over `TEMPORAL_ADDRESS` for this decision.

For the 1Password backend, `OP_SERVICE_ACCOUNT_TOKEN` wins. Otherwise, on
macOS, toolkit reads the enrolled service account from Keychain and invokes
`op` with that token. The token is passed only to that `op` child; toolkit
never exports it into its own environment, so no other child inherits it.

The installed binary caches each service-account read in the login Keychain
(service `toolkit-credential-cache`, one item per `op://` reference keyed by
its SHA-256) for `credentialCacheTtlSeconds` (default one day; `0`
disables). The whole 1Password account shares one daily request budget
(1,000 on the current plan) across every host and agent, and an agent may call
kubectl or talosctl hundreds of times an hour; the cache keeps that to roughly
one read per credential per day. Concurrent callers that miss the cache take a
per-reference lock under `~/Library/Caches/toolkit/credential-locks`, so only
one of them reads. Cache hits are silent. After rotating a secret, run
`toolkit credentials flush [NAME...]`; otherwise the old value is served until
its entry expires.

Keychain items trust the binary that created them by its code signature, so
only the installed toolkit uses the cache, and `install:local` signs it with
the single "Developer ID Application" identity in the login Keychain
(identifier `red.sjer.toolkit`) and fails without one. An ad-hoc signature
changes on every build and would stall unattended agents on an access
prompt. A process that cannot use the cache, such as a `bun
packages/toolkit/src/index.ts` source run or a package importing
`@shepherdjerred/toolkit/lib/credentials.ts`, borrows the installed binary's
cache: it resolves each credential through
`~/.local/bin/toolkit run --env NAME -- printenv NAME`. Without an installed
binary it reads 1Password directly and warns that the read spends the shared
budget. If the command reports missing enrollment, use the repository's
existing setup from its root:

```bash
swift scripts/onepassword/enroll-service-account.swift
```

If it instead reports that the process cannot see the login Keychain, the
enrollment is intact; do not re-enroll. The process is outside the GUI login
session (`launchctl managername` prints `Background`, and
`security list-keychains` shows only the System keychain), typically because
an SSH login that has since ended started it, such as an SSH-started herdr
holder. Run the command from the GUI login session or replace that process.
A `could not be read from 1Password: …` error quotes `op`'s reason instead; a
rate limit there means the shared budget is exhausted, not that enrollment is
missing, and the error names the exhausted budget and when it resets from
`op service-account ratelimit`.

Every resolution other than an ambient variable appends one JSON line to a
daily file, `~/.toolkit/logs/credential-reads-YYYY-MM-DD.jsonl` (UTC; files
older than 14 days are deleted): `ts`, `host`, `runtime` (`installed` or
`source`), `command` (the first two command words), `ppid`, `name`, `backend`
(`cache`, `delegated`, `service-account`, `config` or `keychain`; `null` on
failure) and `outcome` (`ok`, `rate-limited` or `error`). Values are never
logged. `scripts/onepassword/with-service-account.sh` appends a `wrapper` line
to the same file for each command it starts. A source run delegates only when
the installed binary resolves the name to the same `op://` reference (checked
with `toolkit credentials references --json`), and passes an explicit
`OP_SERVICE_ACCOUNT_TOKEN` to it. To see what spent the budget:

```bash
jq -r 'select(.backend == "service-account" or .backend == "config" or .backend == "wrapper") | [.host, .runtime, .command, .name] | @tsv' \
  ~/.toolkit/logs/credential-reads-*.jsonl | sort | uniq -c | sort -rn | head
```

Commands outside toolkit reuse the same Keychain credential by wrapping
`op run` or `op read` with `scripts/onepassword/with-service-account.sh`, so
homelab-vault references never wait for 1Password desktop approval. Packages
can also call `resolveCredentials` from `@shepherdjerred/toolkit/lib/credentials.ts`
before spawning subprocesses, as the Temporal Worker Deployment rollout does.

Outside macOS, supply `OP_SERVICE_ACCOUNT_TOKEN` through the existing secret
manager integration. For Discord, a missing credential error names the exact
workstation-secret enrollment command. Never paste tokens into chat,
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
| `OPS_DASHBOARD_URL` / `ops.dashboard.url`                         | `https://hub.tailnet-1a49.ts.net`                     |
| `BRIM_SYNC_MACHINE_ID` / `brim.sync.machine.id`                   | normalized hostname                                   |
| `BRIM_SYNC_BUCKET` / `brim.sync.bucket`                           | `brim-sessions`                                       |
| `BRIM_SYNC_PROFILE` / `brim.sync.profile`                         | `brim-sync` (AWS profile)                             |
| `BRIM_SYNC_S3_CREDENTIALS` / `brim.sync.s3.credentials`           | `profile` (`broker` on agent hosts)                   |
| `BRIM_SYNC_RECIPIENT` / `brim.sync.recipient`                     | the archive's age public key                          |
| `BRIM_SYNC_PULL_SINCE_DAYS` / `brim.sync.pull.since.days`         | `30`                                                  |
| `BRIM_CAPTURE_ENABLED` / `brim.capture.enabled`                   | `false`                                               |
| `BRIM_CAPTURE_PORT` / `brim.capture.port`                         | `47821`                                               |
| `BRIM_CAPTURE_RETENTION_DAYS` / `brim.capture.retention.days`     | `30`                                                  |
| `BRIM_CAPTURE_CLIS` / `brim.capture.clis`                         | `["claude", "codex"]` (comma list in the environment) |
| `CREDENTIAL_CACHE_TTL_SECONDS` / `credential.cache.ttl.seconds`   | `86400` (`0` disables the Keychain read cache)        |

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
