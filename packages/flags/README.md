# Flags

The flag service stores one document per deployment a workload reads. Prod-only
workloads have one document. Scout and Karma have a second document because a
second workload reads one. Storm forum and storm brain share `storm/prod`.
A document is a list of boolean flags with ordered segment rollouts, or
variant flags whose value is one string.

The chart is prepared and inactive (`FLAGS_ACTIVE` is false), so this package
does not deploy and Flipt still serves live evaluation. SQLite lives on the
service's own ZFS volume at `/var/lib/flags`, not on the Flipt git volume.

## HTTP

`GET /healthz` answers the probes.

Credentialless routes reject an `Authorization` header:

- `GET /v1/deployments/:catalog/:stage/snapshot` returns the document and an
  `ETag`. `If-None-Match` returns 304.
- `POST /v1/evaluate` with `{ deployment, key, context }` returns
  `{ enabled }` for a boolean. A missing flag is 404 `FLAG_NOT_FOUND`. A
  variant flag is 400. `enabled: false` is a successful answer.

Management routes require the brokered `FLAGS_MACHINE_TOKEN` or a tailnet
operator login inserted by a trusted proxy. Browser writes must be
same-origin. The routes are list, get, `apply`, `create-missing`, `retire`,
and `diff`. `apply` and `retire` take `expectedRevision` and change nothing
when it does not match, including later flags in that request.
`create-missing` inserts absent keys and leaves an existing body as it is.

Startup copies each deployment once. When `FLAGS_FLIPT_URL` is set, that copy
is the Flipt document the deployment's pods read, and a percentage rollout,
variant rule, or other unsupported construct stops the process. Without that
variable, startup copies the managed inventory document. A document already
stored is left alone. Namespace and environment pairs that no deployment
reads, including the unused beta copies, are reported and not imported.

## Operator

The browser UI is served by this process. The sidebar lists real deployments:
a prod-only catalog is one row, and Scout and Karma list Beta and Prod. A flag
row shows its key, On/Off/Targeted (or the variant string), and its type.
Saving a flag shows the before and after document, then writes that revision.
A conflicting write is left unchanged and the other value is shown.

`toolkit flags` is the command surface. See `packages/toolkit/README.md`.

Activation, the consumer cut, and removing Flipt are later changes. They wait
on an empty live diff.
