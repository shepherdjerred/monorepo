---
title: How the Delivery web app follows a change
description: Why the Delivery web app models a change as one execution from commit to runtime, and where each part of that picture comes from.
sidebar:
  order: 3
---

The Delivery web app shows one change as one execution, from the commit that
produced it to the runtime that accepted it.

Woodpecker, Delivery, Temporal and ArgoCD each own a step of a release. Each
tool shows its own step well and the others not at all. The Delivery web app
joins the steps into one pipeline view, in the shape of AWS CodePipeline. It
then links back to each tool for detail.

## An execution is a build traced forward

A Woodpecker push publishes a build: one source revision and its artifacts.
Qualification turns a verified build into an automatic version set. Deployments
then carry that version set through each environment, in promotion order.

The web app follows those identities forward instead of inventing a new one. A
build, its version set, and the deployments of that version set form one
[execution](https://github.com/shepherdjerred/monorepo/blob/6a9c4be858a1f28db96cd1aa9e608af85c4273fb/packages/delivery/src/infrastructure/hub/executions.ts).
A hand-composed version set is its own execution, with no source or build stage.
OpenTofu stacks and static sites are services like any other, so their
releases join through their own builds.

The [service
pipeline](https://github.com/shepherdjerred/monorepo/blob/6a9c4be858a1f28db96cd1aa9e608af85c4273fb/packages/delivery/src/infrastructure/hub/pipeline.ts)
shows the newest run that reached each stage. Like CodePipeline, adjacent stages
can show different revisions while a change is still moving. The executions
history shows each change's own path.

## Delivery stores decisions; other tools hold detail

Delivery's database records what Delivery decides and observes: builds,
artifacts, version sets, deployments, stages, approvals, evidence and the audit
trail. It does not copy CI steps, commit metadata or live ArgoCD state.

Those details [come from their owners on
request](https://github.com/shepherdjerred/monorepo/blob/6a9c4be858a1f28db96cd1aa9e608af85c4273fb/packages/delivery/src/infrastructure/enrichment/enrichment.ts).
Per-workflow CI status comes from Woodpecker, and the web app splits it into Build
and Test stages. Commit author and pull request come from GitHub. Sync, health
and running images come from ArgoCD. A finished pipeline or merged commit cannot
change, so its answer is cached permanently. Live state is only cached for
seconds.

Fetching on request keeps this read-only and unscheduled. Recurring work in this
repository belongs to Temporal. Polling external tools on a schedule would add a
Workflow whose only purpose is a fresher page. An unavailable integration
degrades only its own panel and still links to the tool.

## Change notifications follow commits

Every Delivery decision already writes an audit row inside its transaction. A
[database
trigger](https://github.com/shepherdjerred/monorepo/blob/6a9c4be858a1f28db96cd1aa9e608af85c4273fb/packages/delivery/prisma/migrations/20261018120000_delivery_hub/migration.sql)
turns that row into a PostgreSQL notification, which is delivered only after the
transaction commits. The server [relays
notifications](https://github.com/shepherdjerred/monorepo/blob/6a9c4be858a1f28db96cd1aa9e608af85c4273fb/packages/delivery/src/server/events-route.ts)
to browsers as Server-Sent Events. A browser therefore never refetches before
the change is visible. Writes from the Temporal executor, CI and operators all
arrive the same way.

Events are not replayed. A browser that reconnects refetches what it shows
instead, which is simpler than storing a durable event log.

## A browser application that opens on the record

Every page has a
[URL](https://github.com/shepherdjerred/monorepo/blob/6a9c4be858a1f28db96cd1aa9e608af85c4273fb/packages/delivery/src/client/router.tsx).
Links are real anchors, filters and pages are search parameters, and forms are
native. Back, forward, new tabs, bookmarks and shared links therefore behave as
they do on any website. Approvals use the browser's form validation.
Cancellations and retirements confirm through a native modal dialog.

The home page is an overview of every active service and where it runs. It
answers one question before any other: does anything need a person? Waiting
approvals, failed deployments and required recoveries are [read from the
record](https://github.com/shepherdjerred/monorepo/blob/e78ed9e2d360ecaae482f2820fa41d021ba94a97/packages/delivery/src/infrastructure/hub/overview.ts)
and listed first. Below them, each service is a tile with one chip per
environment, in promotion order.

A chip states what Delivery last recorded for that environment. It shows the
outcome of the newest deployment and the revision the environment accepted. It
is not live health. A green chip means the last deployment succeeded, not that
the workload is running now.

That limit is deliberate. Asking ArgoCD about every environment on each load
would make the home page as slow and as fragile as its slowest integration.
Live sync, health and images stay on an environment's own page, which asks
about one environment at a time. The overview is refetched on every change
notification, so it reads the record by set and traces no execution.

The overview is not a matrix of services against environments. In the
[catalog](https://github.com/shepherdjerred/monorepo/blob/e78ed9e2d360ecaae482f2820fa41d021ba94a97/packages/ops-model/catalog-document.json),
almost every service has a single `prod` environment. A matrix would be one
full column beside several empty ones. A tile carries only the environments its
service has.

Tiles sit in one panel per catalog kind: products, workloads and platform. Most
catalog groups hold one service, so a panel per group would repeat each name. A
group of several services keeps its own heading inside its kind.

## Related

- [Why releases are shaped this way](/explanation/homelab/release-safety/)
- [How to cut a homelab release](/how-to/cut-a-homelab-release/)
- [Delivery package README](https://github.com/shepherdjerred/monorepo/blob/main/packages/delivery/README.md)
