---
title: Why large derived assets live outside Git
description: The rule that derived or large binary assets are stored once in the content-addressed asset bucket behind a tracked sha256 manifest, what it replaced, and why Git LFS was not chosen.
sidebar:
  order: 13
---

A derived or large binary asset is stored once in the asset bucket under its
own SHA-256, and Git tracks a small manifest that names it. Consumers fetch the
object by hash and verify it. A missing or altered object stops them.

The Storm's baked navigation meshes are the first use. The
[`rwf/` content folder](https://github.com/shepherdjerred/monorepo/tree/main/packages/the-storm/server/owned/plugins/TheStorm/rwf)
tracks `nav-manifest.json`; the 45 `nav.rwfnav` files it names are ignored by
Git.

## What Git was paying for

The meshes are build output. The `rwfmap` tool bakes each one deterministically
from a map's schematic and metadata, so Git never held information that the
sources did not already contain.

They were still expensive to track:

- **Checkout size.** 386 MB, a quarter of every checkout, was written again for
  each worktree.
- **History.** A rebake replaces a binary wholesale. The meshes had added about
  2.5 GB of packed history, and every clone carries it.
- **The large-file gate.** Sixteen meshes exceeded the 5 MB limit that
  [`check-large-files`](https://github.com/shepherdjerred/monorepo/blob/main/scripts/checks/check-large-files.ts)
  enforces, so each needed a standing exemption.

## Why the object is named by its hash

Naming an object by the SHA-256 of its bytes makes the store append-only. A
rebake adds a new object and never changes an old one.

That removes three problems at once. Two branches with different bakes cannot
overwrite each other. A revert is an ordinary Git revert of the manifest,
because the older object is still there. And no cache needs invalidating, since
a name can only ever mean one sequence of bytes.

It also makes the transport untrusted. The bucket, the CDN in front of it and
the local cache can all be wrong, and the consumer still catches it, because it
checks the bytes against the hash it was told to expect.

## Why the manifest stays in Git

The manifest is the part of the asset that review and tooling need. A rebake
shows up in a pull request as one changed hash and size. Turborepo and Gradle
cache keys change with it. The image build reads it to know what to download.

So the commit still pins exact bytes. Only the storage moved.

## Why a missing object is fatal

Nothing substitutes for an object the store does not serve. The fetch does not
rebake it, skip it, or continue without it.

A fallback here would hide a real mistake: a manifest committed before its
objects were published. The server runs a map without a mesh for humans only,
so an image built without one would ship and the only symptom would be a map
the bots sit out. Failing the test run, the image build and its smoke check
keeps that mistake at the pull request.

The cost is ordering. A new bake must be published before its manifest is
committed. The package README owns that procedure; see
[The Storm's README](https://github.com/shepherdjerred/monorepo/blob/main/packages/the-storm/README.md).

## Why not Git LFS

Git LFS solves the history problem and leaves the others.

- **It needs a server.** GitHub's is metered by storage and bandwidth, and a
  self-hosted one is another service to run and back up.
- **It widens every clone path.** The
  [repository backup](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/repo/git-backup-git.ts)
  and CI's
  [own checkout](https://github.com/shepherdjerred/monorepo/tree/main/packages/woodpecker-config-extension/src/checkout)
  would each have to fetch LFS objects correctly, with credentials, on every
  run.
- **It still fills each worktree.** LFS smudges a full copy of every file into
  every checkout. The fetch here copies from one shared cache, and shares disk
  blocks with it where the file system can.

The bucket already existed, already serves public plugin jars, and needs no
credentials to read. Reusing it added no infrastructure.

## What it costs

Tests and image builds that read the meshes now depend on the asset bucket
being reachable, where they once depended only on the clone. Objects are never
deleted, so the store grows by one object per rebake.

Both were judged cheaper than the alternative. A rebake that used to add its
full size to every future clone now adds a few lines to one JSON file.

## When a file qualifies

The rule fits a file that is large or derived, changes as a unit, and has
consumers that can run a fetch step before reading it.

It does not fit a file that is the source of truth and edited by hand, or one a
tool must read straight from a fresh clone. Those stay in Git, and a genuine
large source such as a font or an article's video keeps its entry in
`.largeignore`.
