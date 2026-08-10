---
title: Operate Scout evals
description: Reach the review-calibration app, populate its datasets, and keep its trust boundary intact.
sidebar:
  order: 11
---

Scout review evals is the post-match review calibration app. It has no
application-level login — being on the tailnet _is_ the access grant.

Treat tailnet membership accordingly.

## Reach it

Open `https://scout-evals.<tailnet>.ts.net` from any tailnet device. No
credentials are prompted.

Off the tailnet there is no route at all, which is the intended behaviour.

## Populate datasets

Use the evals CLI from `packages/scout-for-lol/packages/evals`:

| Command         | Purpose                        |
| --------------- | ------------------------------ |
| `sync-beta`     | pull from the beta environment |
| `discover`      | find candidate material        |
| ingest commands | load prepared datasets         |

See the package README for the exact invocations. The hosted instance is the
durable home for the resulting SQLite database.

## Guard the boundary

Two rules, both load-bearing:

- **Never configure Funnel** on this ingress. Funnel publishes the service to
  the public internet, which would expose an unauthenticated admin surface.
- **Guard tailnet membership like a login.** Anyone on the tailnet with routing
  to this service can read and write every eval dataset.

## Expect a restart to interrupt you

All datasets live in one WAL-mode SQLite file on a read-write-once ZFS volume.
Because it is single-writer, the Deployment uses the `Recreate` strategy — an
old and new pod never run concurrently.

That means a deploy briefly takes the app down rather than rolling. This is
correct; a rolling update would risk WAL corruption.

## Related

- [Why the tailnet is the auth layer](/explanation/homelab/scout-evals-trust-boundary/)
