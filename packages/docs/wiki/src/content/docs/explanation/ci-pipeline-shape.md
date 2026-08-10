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
  wiki, and Scout evals. The browser matrix comes from the pinned
  `ci-playwright` image, so the lane is about published sites rather than about
  Playwright as a tool.
- **llm-observability E2E** is the dedicated Docker/service-backed lane. It
  starts Tempo and MinIO and runs only `@shepherdjerred/llm-observability`'s
  service-dependent tests. It is separate because it is the only lane that needs
  live backing services.
- **OpenTofu** stays split into infrastructure stacks, GitHub resources, and
  Cloudflare resources. Those three have different ordering, concurrency,
  credentials, and retry safety — one lane would have to take the strictest of
  each.
- **Scout** has three deliberate promotion phases: archive and deploy beta, mint
  the immutable tag, then reconcile the production `versions.ts` pin. They are
  three stages of one release, not three independent Scout test suites.

## Optional scans fail differently on purpose

**Trivy** and **Semgrep** are finding scans. Their finding exit statuses are
explicitly soft-failed, while scanner, configuration, and runtime failures stay
hard failures.

That split matters: a soft-failed scanner would silently stop scanning and still
look green. Separating "the scan found something" from "the scan did not run"
keeps the second one a real failure.

## The review gate waits for the exact head

The required PR review gate is Qodo. It waits for Qodo's persistent review
comment to be updated for the exact PR head, and it folds unresolved Qodo
findings into the gate decision.

Binding to the head commit is the whole point. A review comment from an earlier
push is evidence about code that is no longer proposed, and accepting it would
make the gate approve unreviewed changes.

## Main builds upload only the steps they need

A main build starts from a small selector bootstrap rather than the complete
graph. It compares the commit with the last green main build, uploads only the
selected main steps, and preserves the stable step keys and release
dependencies so downstream lanes still resolve.

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
budget, and downstream release jobs read either form through the same reader.

The alternative — always using artifacts — would add a download to every handoff
for values that are usually a few hundred bytes.

## Related

- [About the monorepo](/explanation/monorepo/) — why CI is Buildkite at all
- [Why releases are shaped this way](/explanation/homelab/release-safety/)
- [Buildkite admission](/explanation/homelab/buildkite-admission/) — where CI runs
