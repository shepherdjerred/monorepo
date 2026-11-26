# @shepherdjerred/incidents

One durable record per shared-system breakage or planned maintenance window,
so agents coordinate on a single owner instead of piling up Forum notices.
The package is a Hub module: Hub mounts its server half at `/api/incidents`
and its pages at `/incidents`. It owns its own PostgreSQL database, so it is a
separate workspace package rather than a module inside alert-dashboard.

Resource leases and qualification locks stay Forum notices. Incidents cover
red main CI, stuck Delivery, and outages of the cluster, observability, or
another shared service.

## Exports

| Subpath         | Contents                                                                                               | Consumers                              |
| --------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `./contract`    | Zod wire schemas and enums: read models, command inputs, signal batches, stream frames, error data     | `toolkit incident`, Temporal, Hub UI   |
| `./router`      | `IncidentsRouter`, the tRPC router type (type-only)                                                    | typed tRPC clients                     |
| `./alert-rules` | `INCIDENT_ALERTNAMES`, `INCIDENT_ALERT_RULES`, `INCIDENT_ALERT_RECEIVER`, `INCIDENT_ALERTMANAGER_PATH` | the homelab Alertmanager route         |
| `./hub-server`  | `createIncidentsHubServer(options)` and `createIncidentsFixtureHubServer(options?)`                    | Hub's `src/modules/incidents/` adapter |

`IncidentsRouter` lives in its own subpath because `./contract` is the
`shared` layer, which may not import the server layer, even for types.

### `createIncidentsHubServer(options)`

Returns `{ id: "incidents", register(app), trpc: { router, createContext }, ready, close, service, bus }`,
structurally a Hub `ServerModule`. The package never imports alert-dashboard;
Hub's adapter checks the object with `satisfies`.

| Option                        | Meaning                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `repository` \| `databaseUrl` | An `IncidentsRepository`, or a PostgreSQL URL (`INCIDENTS_DATABASE_URL`) for the Prisma one     |
| `webhookToken`                | Bearer token for `POST /alertmanager` (Hub's `WEBHOOK_TOKEN`); without it the route answers 503 |
| `opsIngestToken`              | Bearer token for `POST /internal/signals` (Hub's `OPS_INGEST_TOKEN`); without it, 503           |
| `publicOrigin`                | Origin for `url` fields; default `https://hub.tailnet-1a49.ts.net`                              |
| `flags`                       | An `IncidentsFlagReader`; default reads Hub's process-wide flag client                          |
| `clock`, `heartbeatMs`        | Injected time and the SSE heartbeat interval (default 8 s)                                      |

`createIncidentsFixtureHubServer()` returns the same object over an in-memory
repository seeded through the service: an open sev1 Delivery incident under
an active dispatch lease (opened by `DeliveryRecoveryRequired`, two affected
agents), an owned main-ci incident with a suspect, a scheduled database
maintenance, and a resolved Tracker incident. Its fixture tokens are
`fixture-webhook-token` and `fixture-ops-ingest-token`, and the seeded lease
lasts six hours so it stays live during UI work.

## Record

An incident is `INC-<number>`, numbered from the `incidents_number_seq`
sequence (a declaration that loses a dedupe race can consume a number, so
numbers may skip). Each has a `kind` (`incident` or `maintenance`), title,
summary, optional impact, `severity` (`sev1` is most severe), one or more
`systems` from the closed enum in the contract plus free-form `components`, a
required `exitCondition`, a `source` (`manual`, `alertmanager`, `main-ci`), an
optional `suspect` (commit SHA, PR number, branch, session id, author), and a
`revision`. Every mutation of an existing incident that carries
`expectedRevision` is refused with CONFLICT when the revision moved.

The timeline is append-only with a per-incident `seq`. Links, attached
signals, and affected actors (agents blocked by the incident) are kept with
the record.

### Lifecycle

| Kind        | Statuses                                                  | Terminal                | Reopens to      |
| ----------- | --------------------------------------------------------- | ----------------------- | --------------- |
| incident    | `investigating`, `identified`, `mitigating`, `monitoring` | `resolved`              | `investigating` |
| maintenance | `scheduled`, `in_progress`, `verifying`                   | `completed`, `canceled` | `in_progress`   |

Open incident statuses move freely among themselves. Maintenance moves
`scheduled → in_progress → verifying` (and back to `in_progress`), and any open
maintenance can be `canceled` with a note. `resolve` is the only way into
`resolved`/`completed`: it needs a resolution note and the commander, or
`force`. Scheduled maintenance cannot be completed; cancel it instead.
Entering `monitoring` or `verifying` stamps `mitigatedAt` once. `canceled`
never reopens.

### Dedupe

At most one open `incident`-kind record holds each system. Declaring,
reopening, or editing systems onto an overlap is refused with CONFLICT and
the existing incident, so the caller can `join` it. Maintenance never dedupes,
and neither does `other`. PostgreSQL enforces the same rule with the
`open_incident_systems` primary key, so concurrent declarations cannot both
win.

## Coordination protocol

Command has one owner. Its state is `none`, `dispatching`, or `owned`.

- **Takeover grace.** `takeoverEligibleAt = declaredAt + grace` (flag, 600 s),
  fixed on the record at declaration. Before it, only the creator or the
  suspect may `take`. An actor is the suspect when its metadata `sessionId`
  or `sessionLink` names the suspect's session (a `Claude-Session:` URL and
  its trailing `session_…` segment match), or its `branch` equals the
  suspect's branch. Anyone else gets `outcome: "taken", reason: "not-eligible-yet"`.
- **take.** Succeeds when nobody owns it; `owned-by-other` and
  `dispatch-in-progress` are answered as `outcome: "taken"`, not errors.
  `force` bypasses the grace and displaces a current commander or dispatcher;
  the timeline records `forced` and what it overrode.
- **Dispatch lease.** `take` with `dispatch: true` (needs the spawn flag)
  holds `dispatching` for the lease time (flag, 600 s) and returns a one-time
  `dispatchToken` and the `provider` to spawn. Only the token's SHA-256 is
  stored. The spawned session calls `claimDispatch` with the token to become
  commander; a spawn failure calls `releaseDispatch`.
- **Lazy expiry.** A lapsed lease reads as `none` immediately, without a
  write, so reads never move `revision`. The next write on that incident
  persists the lapse as a `dispatch-expired` event before its own change.
  There is no timer or sweeper.
- **handoff.** The commander hands command to an actor that has used
  incidents before (`to` is its key), or releases it with `to: null`.

Every claim is decided against one read revision and committed with
`UPDATE incidents ... WHERE id = $1 AND revision = $read`. Of concurrent
claimers exactly one updates a row; the others re-read, see the new owner,
and answer `taken`. Commands without `expectedRevision` (`take`, `join`,
`addLink`, the dispatch calls) re-decide up to eight times under contention;
commands with it fail with the stale-revision CONFLICT instead.

## Signals

Both machine producers go through one domain function, `ingestSignal`. A
producer may resend the same state on every run; only a change in firing
state reaches the timeline.

Each producer key (`source`, `key`) has a durable observation watermark in
`signal_watermarks`: the newest accepted observation time and the state it
reported. It is kept independently of incidents, so it still orders reports
after the incident a signal belonged to has closed. For a report observed at
`t` against a watermark at `w`:

| Report                     | Result                                                            |
| -------------------------- | ----------------------------------------------------------------- |
| `t < w`                    | Ignored; nothing is written                                       |
| `t > w`                    | Accepted; the watermark moves to `t`, even when the state repeats |
| `t = w`, same state        | Ignored as a duplicate delivery                                   |
| `t = w`, firing over clear | Accepted: firing wins a tie                                       |
| `t = w`, clear over firing | Ignored: firing wins a tie                                        |

Firing winning ties makes the result the same in either arrival order and
means a tie never closes an incident. So a retried firing after a newer clear
auto-resolved its incident is ignored, a clear that arrives before its
delayed firing is remembered (and the firing ignored), and a delayed clear
older than a repeated firing cannot resolve. The watermark and the signal's
incident write commit in one transaction, each under its own
compare-and-set; a lost race re-reads and re-decides.

1. A firing signal attaches to the open record it is already attached to,
   else to the open incident holding its system, else to an `in_progress` or
   `verifying` maintenance covering the system. Otherwise it opens an
   unowned incident (source `alertmanager` or `main-ci`, creator
   `system:alertmanager` or `system:main-ci`), when that producer's auto-open
   flag is on.
2. Attaching a more severe signal raises the incident's severity, and a
   signal's suspect fills an empty suspect.
3. A clear records `signal-cleared`. When every attached signal has cleared,
   nobody ever held command, and the incident was opened by a signal (not
   declared by hand), it auto-resolves with a note. Otherwise the commander
   sees the clear on the timeline and decides.

### Alertmanager

`POST /api/incidents/alertmanager` takes the Alertmanager v4 webhook body
(schema copied in `src/shared/alertmanager.ts`). Only curated alertnames act;
others are counted as `uncurated`. The fingerprint is the signal key, the
`summary` annotation the title, and `message` or `description` the summary;
the generator URL and `runbook_url` become links.

| Alertname                        | Severity | Why                                                                         |
| -------------------------------- | -------- | --------------------------------------------------------------------------- |
| `DeliveryUnavailable`            | sev1     | The control plane is down, so no release can be submitted or recovered      |
| `DeliveryRecoveryRequired`       | sev1     | A recovery-required holder keeps the dispatch barrier and never self-clears |
| `DeliveryContentBarrierStuck`    | sev1     | Every Delivery claim answers BUSY until the barrier is restored             |
| `DeliveryDispatchDelayed`        | sev2     | Releases are late but nothing is lost; the outbox holds them                |
| `DeliveryQueueStalled`           | sev2     | One environment is stuck; others may still ship                             |
| `DeliveryPlatformLockStranded`   | sev2     | Only platform deployments are blocked; workloads still ship                 |
| `DeliveryRecoveryIntentsPending` | sev3     | Blocks control-plane upgrades and the handover; ordinary deploys proceed    |

All map to the `delivery` system. The homelab route imports
`INCIDENT_ALERTNAMES` from `./alert-rules` as its matcher list, so the route
and the receiver cannot drift.

### main-ci

The Temporal `ops-snapshot` workflow posts an `IncidentSignalBatch` to
`POST /api/incidents/internal/signals` with `Bearer OPS_INGEST_TOKEN`: key
`main-ci:main`, `firing` while main is red, and a suspect parsed from the
failing commit.

## API

tRPC at `/api/incidents/trpc` (no transformer; instants are ISO strings).
Every mutation carries the acting `actor`; inputs and outputs are validated
with the contract schemas.

| Procedure                                                            | Kind     | Returns                |
| -------------------------------------------------------------------- | -------- | ---------------------- |
| `viewer`                                                             | query    | `ActorInput \| null`   |
| `list` (`state` open\|resolved\|all, `kind`, `system`, `limit`)      | query    | `IncidentSummary[]`    |
| `byRef` (`ref`: `INC-N`, `N`, or id)                                 | query    | `IncidentDetail`       |
| `check` (`system`, `actor`)                                          | query    | `CheckIncidentsResult` |
| `declare`                                                            | mutation | `IncidentDetail`       |
| `postUpdate`, `changeStatus`, `edit`, `handoff`, `resolve`, `reopen` | mutation | `IncidentDetail`       |
| `addLink`, `join`, `leave`, `claimDispatch`, `releaseDispatch`       | mutation | `IncidentDetail`       |
| `take`                                                               | mutation | `TakeCommandResult`    |

`list` with `state: "open"` and `check` sort by severity, then newest; `list`
applies that order before `limit`, so a newer, less severe incident cannot
hide an older sev1. Other states list newest first.
`check` reports the actor's relation to each open incident (`commander`,
`creator`, `suspect`, `affected`, `canTake`) without recording the actor.

Refusals map to tRPC codes: `BAD_REQUEST`, `FORBIDDEN` (not the commander,
or writes disabled), `NOT_FOUND`, `PRECONDITION_FAILED` (spawning disabled),
and `CONFLICT`. A CONFLICT carries `error.data.incident`
(`IncidentErrorDataSchema`): `{ code: "duplicate-incident", existing, systems }`
or `{ code: "stale-revision", expectedRevision, incident }`.

REST under `/api/incidents`:

| Route                    | Auth                      | Body / response                                               |
| ------------------------ | ------------------------- | ------------------------------------------------------------- |
| `GET /events/stream`     | none (tailnet)            | SSE; `?incident=INC-N` filters                                |
| `POST /alertmanager`     | `Bearer WEBHOOK_TOKEN`    | v4 webhook → 202 `IncidentSignalBatchResult` plus `uncurated` |
| `POST /internal/signals` | `Bearer OPS_INGEST_TOKEN` | `IncidentSignalBatch` → 202 `IncidentSignalBatchResult`       |

Bearer tokens are compared in constant time over SHA-256 digests. Readiness
(`ready()`, Hub's `/readyz/incidents`) pings the database.

The stream opens with `retry: 3000` and a `: connected` comment, sends one
`event: incident` frame (`IncidentStreamFrame`) per committed change, and a
`: heartbeat` comment every 8 s while idle. Frames name the change; clients
refetch. The bus is in-process: Hub runs one replica with the Recreate
strategy. A subscriber more than 1000 frames behind is disconnected and
should reconnect and refetch.

## Actor identity

The tailnet is the access boundary; Hub has no login. As with Tracker, the
actor is self-asserted in the input body and is attribution, not
authorization. Agents send the same envelope `toolkit` sends Tracker; actors
are upserted by `key`.

Browser writes use the Tailscale identity Hub's ingress inserts for
requests from a user's device. `createContext` reads `Tailscale-User-Login`
and `Tailscale-User-Name`; when present, a mutation whose body actor has
`kind: "human"` is attributed to `human:<login>` (lowercased) instead.
Agent, runner, and system actors are never replaced, so a CLI on a laptop
keeps its session identity. The UI calls `viewer` to show who it acts as and
sends any human actor (for example `human:browser`) in mutation bodies; in
fixture mode, without the header, that body actor is used as sent.

## Flags

In the `alert-dashboard` namespace, read per call from `alert-dashboard/prod`
through Hub's flag client (targeting key `alert-dashboard`). A failing flag
source falls back to the default; a present invalid value throws.

| Key                                                        | Default       | Effect                                                                           |
| ---------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------- |
| `alert-dashboard-incidents-enabled`                        | `true`        | Off: mutations are FORBIDDEN, signals are ignored, the stream is 404; reads stay |
| `alert-dashboard-incidents-auto-open-alertmanager-enabled` | `true`        | Off: Alertmanager signals attach and clear but never open                        |
| `alert-dashboard-incidents-auto-open-main-ci-enabled`      | `true`        | Off: main-ci signals attach and clear but never open                             |
| `alert-dashboard-incidents-takeover-grace-seconds`         | `600`         | Grace fixed on each record at declaration                                        |
| `alert-dashboard-incidents-dispatch-lease-seconds`         | `600`         | Dispatch lease length                                                            |
| `alert-dashboard-incidents-takeover-spawn-enabled`         | `true`        | Off: `take` with `dispatch` is PRECONDITION_FAILED                               |
| `alert-dashboard-incidents-takeover-provider`              | `claude-code` | Provider returned with each dispatch lease                                       |

## Environment

The package reads no environment itself; Hub passes the values in.

| Variable                 | Used for                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `INCIDENTS_DATABASE_URL` | Hub's `databaseUrl`, and `prisma.config.ts` (default `postgres://postgres@127.0.0.1:5471/incidents`) |
| `WEBHOOK_TOKEN`          | Alertmanager receiver bearer                                                                         |
| `OPS_INGEST_TOKEN`       | Temporal signal bearer                                                                               |

## Development

```bash
bun run --cwd packages/incidents generate        # Prisma client into generated/
bunx turbo run typecheck test lint --filter=@shepherdjerred/incidents
bun run --cwd packages/incidents test:extended   # PostgreSQL tier (shared test server on 5471)
```

Layers are `shared` → `domain` → `infrastructure` → `server`, with `client`
reserved for the Hub pages; `check-architecture` enforces them with negative
fixtures in `architecture-fixtures/`. Unit tests use the in-memory repository,
which gives the same compare-and-set and dedupe guarantees. The extended tier
(`src/server/postgres.integration.test.ts`) migrates a disposable database
and proves single-winner claims and declarations under concurrency.

Schema changes: edit `prisma/schema.prisma`, then add a migration with
`bunx prisma migrate dev --name <change>` against a local database. Hub's init
container applies migrations with `prisma migrate deploy`.
