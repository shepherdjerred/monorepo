# Operations, observability, and security

## Use complementary signals

Temporal Cloud/Service metrics and SDK metrics are separate:

- Service metrics show what Temporal accepted, persisted, throttled, limited,
  replicated, or observed.
- SDK metrics show Client/Worker polling, task execution, slots, cache, replay,
  failures, and local latency.

Collect both. A healthy Service endpoint does not prove Worker telemetry or
business progress; a live Worker process does not prove queue progress.

Read request count, configured limit, and throttle together. One-minute averages
can hide bursts. SDK retries can expire, so an unhandled failed start/Signal/
Update is not delivered merely because the SDK retried it.

Cloud-side latency is not end-to-end latency. The path can include network,
proxy, Codec Server, lock contention, Task Queue wait, Workflow/Activity code,
and downstream systems.

## Logs and traces

Temporal UI is an execution/history inspection surface, not an application-log
store. Emit structured replay-aware Workflow logs, Activity logs, metrics, and
traces to the normal observability system.

Include stable context such as Namespace, Task Queue, Workflow Type, Workflow
ID, Run ID, Activity Type/ID, and attempt where appropriate. Do not place
high-cardinality identifiers in metric labels without a bounded design. Do not
log payloads or failure data that can contain credentials, PII, prompts, or
business secrets.

Workflow logging is replay-aware. Sinks are not durable/retried orchestration
effects and can add Workflow Task latency; do not use a Sink for business state.

## Visibility and application reads

Visibility and Search Attributes support operational discovery/listing. They
are eventually consistent for listing/count paths, have separate limits, and
remain plaintext so the Service can filter/order. ID-specific describe/history
uses the execution path and has different semantics.

Use a Query for a compatible live Workflow's read-only state. Do not make Query
availability a durable reporting contract after old Workers retire. Build an
external projection/read model for application reporting and retained reads.

## Audit and export

Cloud Audit Logs cover supported control-plane operations, not Workflow starts,
terminations, or Schedule creation. Acceptance of an async control-plane request
is not final success; follow the asynchronous operation.

Workflow History Export is delayed at-least-once export of closed histories. It
is not Cloud Archival, real-time incident telemetry, or automatic regional
failover. Deduplicate exported objects and account for configured-region outage.

## Encryption and credentials

Payload encryption is client-side. Payload Codecs do not protect Search
Attributes and ordinary configuration does not necessarily protect failure
messages/stacks. Use a compatible Failure Converter when failure fields need
encryption.

A Codec Server is a decryption oracle. Authenticate/authorize it, verify tokens,
restrict network access, use narrow CORS, and keep encrypted payloads encrypted
outside authorized clients. Never expose it as a public convenience endpoint.

API keys authenticate an identity; RBAC authorizes it. Prefer service identities
for Workers, store credentials outside source/history, and rotate by validating
the replacement before removing the old credential. Deleting a live Worker
credential can disconnect pollers and strand work until replacement capacity
authenticates.

## Cloud recovery

Temporal Cloud multi-region recovery does not make the application multi-region
by itself. Test Worker availability, credentials, customer databases, network
paths, Codec Servers, and downstream dependencies in the failover region. Check
replication lag and the current plan/SLA before a failover claim.

## Self-hosting

Self-hosting moves durability obligations down a layer. Production requires:

- strongly consistent supported persistence and backups;
- separate Visibility health and compatible store versions;
- capacity/shard/load proof with representative failure testing;
- TLS, authentication, authorization, and UI/API access controls;
- Service and SDK metrics, alerting, and restore/recovery exercises;
- schema-first sequential minor upgrades, rehearsed under load;
- end-to-end regional recovery including Workers and dependencies.

Update persistence schemas before the matching server binary and follow
documented sequential upgrade rules. A healthy process probe is not proof of
Task Queue or Workflow progress.

## Operational evidence

After an incident or change, report separately:

1. Service/control-plane state;
2. Worker pollers/version and Task Queue health;
3. Workflow Task/Activity failures and replay behavior;
4. execution/history progress;
5. downstream idempotency/effect state;
6. user-visible/business acceptance.
