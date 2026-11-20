---
title: Track a version pin with Renovate
description: Put a hand-written version pin under Renovate with a hint comment, group it with the pins it must equal, and finish the half upgrades Renovate cannot complete.
sidebar:
  order: 10
---

A version pin outside a package manifest is tracked by a hint comment directly
above it. One custom manager in [`renovate.json`](renovate.json), "Hinted
version pins", reads every hint. A check fails the build when a hint is not
read.

## 1. Check that the pin needs a hint

| The pin is                                              | Do this                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| A tool in [`.mise.toml`](.mise.toml)                    | Nothing. Renovate's mise manager tracks it without a hint.            |
| A `FROM` image in a Dockerfile                          | Nothing. Renovate's Dockerfile manager tracks the tag and digest.     |
| An image, chart or integration the cluster runs         | Add it to the [version catalog](packages/version-catalog/README.md).  |
| An OpenTofu provider                                    | Follow [Change an OpenTofu stack](/how-to/change-an-opentofu-stack/). |
| An `ARG`, `ENV`, shell variable or constant in a script | Continue with step 2.                                                 |

Only `dotnet` and `java` carry hints in `.mise.toml`. The mise manager cannot
resolve either one.

## 2. Write the hint

Put the hint on the line directly above the pin. A blank line or another
comment between them hides the pin.

```dockerfile
# renovate: datasource=github-releases depName=cli/cli
ARG GH_CLI_VERSION=2.96.0
```

| Field            | Required | Meaning                                                                      |
| ---------------- | -------- | ---------------------------------------------------------------------------- |
| `datasource`     | yes      | A [Renovate datasource](https://docs.renovatebot.com/modules/datasource/) id |
| `depName`        | yes      | The package in that datasource, such as `owner/repo`                         |
| `packageName`    | no       | The lookup name when it differs from `depName`                               |
| `registryUrl`    | no       | A registry other than the datasource's default                               |
| `versioning`     | no       | A [versioning scheme](https://docs.renovatebot.com/modules/versioning/)      |
| `extractVersion` | no       | A regular expression whose `version` group turns a tag into the version      |

Fields appear in the order of the table. The pin line is one of these forms.

| Form                           | Example                                     |
| ------------------------------ | ------------------------------------------- |
| `ARG` or `ENV` in a Dockerfile | `ARG UV_VERSION=0.13.0`                     |
| A shell variable               | `MISE_BOOTSTRAP_VERSION="v2026.10.6"`       |
| A Python assignment            | `NERD_FONTS_VERSION = "v3.5.0"`             |
| A TypeScript constant          | `export const PYRIGHT_VERSION = "1.1.414";` |

Keep the value in the form upstream tags it. A pin without a leading `v`
stays without one after an update, and a pin with one keeps it.

### Pin a tag together with its commit

Use `github-tags` and put an `ARG` whose name ends in `_COMMIT` on the next
line. Renovate moves the version and the commit in one update.

```dockerfile
# renovate: datasource=github-tags depName=Kometa-Team/Kometa extractVersion=^v(?<version>\d+\.\d+\.\d+)$
ARG KOMETA_VERSION=2.5.1
ARG KOMETA_COMMIT=1b43f5f113242059c74330bebed041d5f94f50c7
```

### Follow a branch head

Use `git-refs` with the repository URL and a ref. `ref=HEAD` follows the
default branch even when upstream renames it.

```dockerfile
# renovate: datasource=git-refs depName=cctools-port packageName=https://github.com/tpoechtrager/cctools-port ref=HEAD
ARG CCTOOLS_COMMIT=904de2a71d4da6a9b30d2efaf912a10ddc7d9ddb
```

:::caution
Renovate rewrites every occurrence of the pinned value inside the hint and the
pin line. Do not repeat the value in the hint.
:::

## 3. Cover the file

Dockerfiles and TypeScript files under a `scripts/` directory are covered
already. For any other file, add its path to the `managerFilePatterns` of the
"Hinted version pins" manager in [`renovate.json`](renovate.json).

## 4. Group pins that must be equal

When a check or a build requires two pins to match, add a `packageRules` entry
with a `groupName` that matches both. Renovate then moves them in one branch.
Match on `matchPackageNames`: the mise manager reports a tool under its
upstream package name, so one rule covers the `.mise.toml` pin and the hinted
copy.

When a checksum sits beside the pin, add a `prBodyNotes` line to the rule that
names the checksum. Renovate cannot compute it.

## 5. Verify

1. Run the hint check:

   ```bash
   bun run renovate-hints
   ```

2. Add the pin to the `HINTED_PINS` table in
   [`scripts/renovate-config.test.ts`](scripts/renovate-config.test.ts) and run
   the tests:

   ```bash
   bunx turbo run test --filter=@shepherdjerred/root-scripts
   ```

3. Confirm Renovate extracts the pin. The run needs no token and writes
   nothing to the repository:

   ```bash
   RENOVATE_ALLOWED_ENV='["BUN_CONFIG_MAX_HTTP_REQUESTS"]' \
   RENOVATE_SECRETS='{"DOCKERHUB_RENOVATE_TOKEN":"unused"}' \
   bunx renovate --platform=local --dry-run=extract \
     --report-type=file --report-path="$TMPDIR/renovate-extract.json"
   ```

   The pin appears under `packageFiles.regex` for its file.

## Finish a half upgrade

A Renovate pull request whose body says **Half upgrade** changed a version but
not the checksum pinned beside it. The image build or a pin check fails until
the checksum matches.

1. Check out the Renovate branch.
2. Refresh the companion the pull request body names, from the checksum file
   upstream publishes for that release.
3. For a `.mise.toml` change, relock:

   ```bash
   mise lock --platform linux-x64,macos-arm64
   ```

4. Run the sync checks, then push:

   ```bash
   bun run toolchain-version-sync
   bun run mise-lock-sync
   ```

## Related

- [Change an OpenTofu stack](/how-to/change-an-opentofu-stack/) covers provider
  pins, which are half upgrades of the same kind.
