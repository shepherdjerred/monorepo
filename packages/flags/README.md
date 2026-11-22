# Flags

The flag service stores one document per deployment a workload reads. Prod-only
workloads have one document. Scout and Karma have a second document because a
second workload reads one. Storm forum and storm brain share `storm/prod`.
A document is a list of boolean flags with ordered segment rollouts, or
variant flags whose value is one string.

`FLAGS_ACTIVE` is `true`, so Delivery deploys `flags/prod` on its own ZFS NVMe
SQLite volume at `/var/lib/flags` as the authoritative feature-flag service.

## HTTP

`GET /healthz` answers the probes. `GET /metrics` exports Prometheus gauges for
stored deployments, revisions, and flag counts on the primary listener.

Credentialless routes reject an `Authorization` header:

- `GET /v1/deployments/:catalog/:stage/snapshot` returns the document and an
  `ETag`. `If-None-Match` returns 304.
- `POST /v1/evaluate` with `{ deployment, key, context }` returns
  `{ enabled }` for a boolean. A missing flag is 404 `FLAG_NOT_FOUND`. A
  variant flag is 400. `enabled: false` is a successful answer.

When `FLAGS_EVALUATION_PORT` is set (`7361` in production), a second listener
mounts only `/healthz`, `/v1/deployments/:catalog/:stage/snapshot`, and
`/v1/evaluate`. It rejects any `Authorization` header on `/v1/*` with 401,
never reads `Tailscale-User-Login`, and omits management routes and the
operator UI so in-cluster consumer NetworkPolicies can open evaluation without
exposing management. The primary `PORT` (`7360`) serves all routes, including
tailnet evaluation, management, and the browser UI.

Management routes require the brokered `FLAGS_MACHINE_TOKEN` or a tailnet
operator login (`FLAGS_OPERATOR_LOGINS`) inserted by the verified Tailscale
ingress proxy (`FLAGS_INGRESS_IDENTITY_DIR` in Kubernetes, which fences the
`flags-flags-ingress-ingress` UID, StatefulSet controller, and ready proxy Pod
IP on each human request) or a local proxy matching `FLAGS_TRUSTED_PROXIES`.
`FLAGS_TRUSTED_PROXIES` accepts comma-separated exact IP addresses (`127.0.0.1`,
`::1`) and CIDR subnets matched with `node:net` `BlockList`, normalizes
IPv4-mapped IPv6 peers, and fails fast at startup on malformed entries or when
combined with `FLAGS_INGRESS_IDENTITY_DIR`. Browser writes must be same-origin
(`FLAGS_PUBLIC_ORIGIN`). The routes are list, get, `apply`, `create-missing`,
`retire`, and `diff`. `apply` and `retire` take `expectedRevision` and change
nothing when it does not match, including later flags in that request.
`create-missing` inserts absent keys and leaves an existing body as it is.

Startup seeds missing deployments from the managed inventory once. Any document
already stored in SQLite is left alone across restarts. Namespace and
environment pairs that no deployment reads, including unused beta copies, are
reported and not seeded.

## Operator

The browser UI is served by this process and uses the shared console look from
`@shepherdjerred/console-ui`. The workspace button at the top of the sidebar is
the app switcher: it lists the other consoles and tools from `ops-model`'s
`CONSOLE_LINKS` and opens them in the same tab. Below it the sidebar lists real
deployments with their flag counts: prod-only catalogs are one row, and Scout
and Karma are grouped with Beta and Prod rows. Below 900px the sidebar is
replaced by a header row with the app switcher and a deployment select.

A deployment's header shows its revision. The flag table lists each flag's key,
its state (On, Off or Targeted with a glyph, or the variant string) and its
type. The search field filters flags by key and keeps the filter in the `?q=`
query, so it survives choosing a flag. Choosing a flag opens its editor beside
the table.

"Review save" opens a dialog with the stored flag before and the draft after;
Save writes that revision. A conflicting write is left unchanged: a warning
above the form shows the other value beside the draft, with a button to load it.

`toolkit flags` is the command surface. See `packages/toolkit/README.md`.
