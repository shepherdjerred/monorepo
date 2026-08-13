---
title: Why the CI pipeline has so many steps
description: What each Buildkite lane actually covers, why the step count is not redundancy, and how main builds upload only the steps a commit needs.
sidebar:
  order: 2
---

The main Buildkite pipeline has a lot of steps, and several of them look like
copies of each other. They are not. Each lane exists because it has a different
scope, a different failure meaning, or a different side effect, and collapsing
any two of them would lose information the pipeline is built to preserve.

## The lanes are phases, not duplicated test suites

- **Browser E2E** covers the shipped Playwright consumers: `sjer.red`, the docs
  wiki, the alert dashboard, and Scout evals. The browser matrix comes from the
  pinned `ci-playwright` image, so the lane is about published sites rather than
  about Playwright as a tool. The lane's scope statement is asserted in
  [`validate-pipeline-clarity.ts`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/scripts/validate-pipeline-clarity.ts)
  against the lane defined in [`pipeline.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml).
- **llm-observability E2E** is the dedicated tracing-stack lane. It starts Tempo
  and MinIO and runs only `@shepherdjerred/llm-observability`'s
  service-dependent tests. That live backing stack is what sets it apart:
  `alert-dashboard-sqlite` also runs integration tests for the alert ledger, but
  against a local SQLite file rather than a service. This lane is the only one
  needing a whole trace pipeline, where a failure means the
  exporter/collector/object-store path broke rather than a query. See the
  `docker-e2e` and `alert-dashboard-sqlite` steps in
  [`pipeline.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml).
- **OpenTofu** stays split into infrastructure stacks, GitHub resources, and
  Cloudflare resources. Those three have different ordering, concurrency,
  credentials, and retry safety — one lane would have to take the strictest of
  each. The three `tofu-*` steps live in
  [`pipeline.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml).
- **Scout** has three deliberate promotion phases: archive and deploy beta, mint
  the immutable tag, then reconcile the production `versions.ts` pin. They are
  three stages of one release, not three independent Scout test suites. The
  `scout-*` steps are ordered in [`pipeline.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml).

## Optional scans fail differently on purpose

**Trivy** and **Semgrep** are finding scans. Their finding exit statuses are
explicitly soft-failed, while scanner, configuration, and runtime failures stay
hard failures. The exact `soft_fail` exit statuses are pinned in
[`pipeline.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml) and asserted in
[`validate-pipeline-clarity.ts`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/scripts/validate-pipeline-clarity.ts).

That split matters: a soft-failed scanner would silently stop scanning and still
look green. Separating "the scan found something" from "the scan did not run"
keeps the second one a real failure.

## The review gate waits for the exact head

The required PR review gate is Qodo. It waits for Qodo's persistent review
comment to be updated for the exact PR head, and it folds unresolved Qodo
findings into the gate decision. The gate is
[`wait-for-review.ts`](https://github.com/shepherdjerred/monorepo/blob/main/scripts/wait-for-review.ts).

Binding to the head commit is the whole point. A review comment from an earlier
push is evidence about code that is no longer proposed, and accepting it would
make the gate approve unreviewed changes.

## Main builds upload only the steps they need

A main build starts from a small selector bootstrap,
[`main-bootstrap.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/main-bootstrap.yml), rather than the
complete graph. [`select-main-pipeline.ts`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/scripts/select-main-pipeline.ts)
compares the commit with the last green main build, uploads only the selected
main steps, and preserves the stable step keys and release dependencies so
downstream lanes still resolve.

Selection-contract, comparison-base, and lane-decision failures upload the
complete main graph instead. The fallback is deliberately the expensive
direction: a broken selector must never be able to skip a lane.

The bootstrap itself is not soft-failed. Invalid configuration, a failure to
load the immutable image pins, and any failure to validate or upload the
complete graph stay hard build failures — a selector that cannot even fall back
correctly is not a degraded optimization, it is a broken build.

## Handoffs stay small, then spill to artifacts

Steps pass values to later steps through Buildkite metadata. Image digests and
pin candidates move to artifacts automatically once they exceed the metadata
budget in [`buildkite-handoff.ts`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/scripts/buildkite-handoff.ts),
and downstream release jobs read either form through
[`read-buildkite-handoff.ts`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/scripts/read-buildkite-handoff.ts).

The alternative — always using artifacts — would add a download to every handoff
for values that are usually a few hundred bytes.

## Related

- [About the monorepo](/explanation/monorepo/) — why CI is Buildkite at all
- [Why releases are shaped this way](/explanation/homelab/release-safety/)
- [Buildkite admission](/explanation/homelab/buildkite-admission/) — where CI runs
