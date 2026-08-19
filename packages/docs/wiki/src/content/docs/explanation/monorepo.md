---
title: About the monorepo
description: Why everything lives in one Bun workspace, what that buys, and what it costs.
sidebar:
  order: 1
---

Everything is one repository: a Discord bot, a Kubernetes homelab, a League of
Legends analysis pipeline, an Obsidian plugin, dotfiles, and about twenty other
things. One `bun.lock`, one root workspace, one CI pipeline.

That is a deliberate choice, and an unusual one for a personal project.

## Why one repo

The packages are not independent. Scout's report renderer feeds a Discord bot.
The homelab deploys the Temporal worker, which opens PRs against the repo that
defines it, which CI then builds into the image the worker runs as. Splitting
these apart would mean version-coordinating a cycle.

A single workspace makes that cycle a non-issue. Internal dependencies are
`workspace:*` — live symlinks, so there is no publish step, no version bump, and
no copy staleness between a change and its consumer.

## The isolated linker

The root `bunfig.toml` sets Bun's **isolated linker**. Every package resolves
its own dependencies and peers strictly, rather than reaching into a hoisted
top-level `node_modules`.

This costs a little disk and buys a category of bug never happening: a package
importing something it did not declare, working locally because a sibling
happened to install it, and failing in a container that installs a different
set. Phantom dependencies and hoisting split-brain are not possible.

One root `bun install` covers every package. There is no per-package install and
no setup script.

## Turbo, and why local and CI verification differ

`bunx turbo run <task> --filter=<pkg>` is the normal loop. Turbo caches by task
inputs, so an unchanged package is near-instant.

Local and CI verification deliberately have different scopes:

- The **pre-commit hook** checks staged files only — secrets, formatting, line
  endings, and the banned automation patterns. It is fast enough to not be
  resented.
- **Buildkite** runs the exhaustive root `bun run verify` graph on every PR.
  That is the real gate.

Running the full graph locally is for reproducing a CI failure or changing the
verification machinery, not for everyday work. There is no pre-push hook.

## CI is Buildkite, not GitHub Actions

`.buildkite/pipeline.yml` is the single canonical source: every step is written
there by hand, and PR builds upload it unchanged. Default-branch builds take a
bootstrap path instead, where `select-main-pipeline.ts` uploads the subset of
those same steps the commit actually needs. So the graph main runs is selected
rather than authored — no step exists that is not in the checked-in file.

This matters mostly because it breaks a common assumption: GitHub Actions is
not the source of truth for CI here. The exact Buildkite build for a commit is.

CI itself runs on the homelab — a dedicated `liskov` worker under
[Kueue admission](/explanation/homelab/buildkite-admission/). The homelab is
therefore in the path of merging, which is a real coupling and an accepted one.

## One command boundary for the stack

The repository spans more control planes than its package graph suggests:
GitHub, Buildkite, Linear, PostHog, Grafana, Temporal, ArgoCD, Cloudflare, and
Tailscale all participate in ordinary work. `toolkit` is the stable entrypoint
across that stack.

It does not replace those platforms' native CLIs. For platform operations it
delegates directly, adding only the monorepo's repository, organization,
workspace, project, or homelab context. Native help, arguments, streams, and
failure behavior remain intact. This keeps vendor capabilities current without
growing a second API client inside the repo.

Toolkit owns only the workflows that combine multiple sources or encode local
policy. PR health, for example, joins GitHub review metadata with a fresh local
merge-tree and the exact-head Buildkite build. Deployment tracing follows a
commit farther still, through image publication, GitOps state, and the running
pod digest. The distinction keeps one memorable command boundary without
hiding which system is authoritative.

## What the strictness is for

The engineering rules in `AGENTS.md` — no type assertions, no silent fallbacks,
no suppressed errors, no `|| true` in automation — read as severe for a personal
repo. They exist because most of this code runs unattended.

A scheduled workflow that swallows an error does not page anyone; it just
quietly stops doing its job, and you find out months later. Failing loudly is
the only feedback channel an unattended system has.

## Related

- [Why the CI pipeline has so many steps](/explanation/ci-pipeline-shape/) — what each lane covers
- [About the homelab](/explanation/homelab/overview/) — where most of it runs
- [Why Temporal](/explanation/temporal/overview/) — where the automation lives
- [How this wiki works](/explanation/how-this-wiki-works/)
