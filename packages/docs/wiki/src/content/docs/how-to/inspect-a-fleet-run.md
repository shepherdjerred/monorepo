---
title: Inspect a fleet run
description: Reopen the dashboard, read a captured run's evidence, and verify its integrity offline.
sidebar:
  order: 2
---

Every fleet run writes a private local bundle. Three commands read it back.

Bundles are local-only and kept indefinitely, so a run from weeks ago is still
inspectable.

## Reopen the dashboard

```bash
bun run pr:fleet:watch                 # newest run
bun run pr:fleet:watch --run <id|dir>  # a specific run
```

Works for live and finished runs. A standalone or historical dashboard is
read-only.

## Read the evidence

```bash
bun run pr:fleet:inspect --run <run-id-or-directory>
```

This gives a body-masked view: which evidence the controller saw, which
decision it made, what model and command activity happened, and how the final
fleet state was reached.

Bodies are hidden by default. Add `--show-bodies` when you actually need the
payloads, and `--json` for machine-readable output.

## Verify integrity

```bash
bun run pr:fleet:replay --run <run-id-or-directory>
```

Replay is a deterministic offline audit. It checks event-chain integrity,
lifecycle correlations, question PR and head binding, single-answer lifecycle,
tick snapshots, aggregate counts, and final state.

It never contacts a model or the network, runs a command, or writes to a
checkout. Use it when you want to trust a run's record rather than re-read it.

## If the bundle will not open

The controller refuses to start unless its state directory is owned by you with
mode `0700`, and it writes files `0600`. A bundle copied between machines or
restored from a backup often loses that, and the tools will reject it.

Fix the modes rather than relaxing the check.

## Related

- [PR fleet run bundle](/reference/pr-fleet-run-bundle/) — what is in it
- [PR fleet CLI](/reference/pr-fleet-cli/) — every flag
