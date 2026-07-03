# Renovate — group all non-code deps into one manual-merge PR

## Status

In Progress (PR open)

## Context

Two threads this session:

1. **Verified the aws-lockfile OOM fix (#1363) is working.** A forced Mend run
   (`2026-07-03 17:43` log) completed cleanly — `result: done`, ~7 min, 0 errors,
   **0** `Calculating hashes` attempts (the OOM trigger), no `renovate/aws-6.x-lockfile`
   branch created, and Dependency Dashboard #481 regenerated (was stuck at 01:40 UTC,
   before the 02:21 fix commit). aws version PRs still surface. See
   `2026-07-02_renovate-aws-lockfile-oom.md`.
2. **The "Repository Problems" banner** on #481 (`Could not re-extract the packageFile
after updating it`, ×4) is a **cosmetic false positive** from Renovate's `bun`
   manager re-extraction self-check. Verified PRs #1368 (`@anthropic-ai/sdk` → 0.100.1
   across 3 packages + interview-practice) and #1369 (`@lancedb/lancedb` → ^0.30.0) have
   complete, correct diffs (package.json + bun.lock all updated, compound peer range
   widened properly). Nothing broken; banner clears once those PRs merge. No config
   change made for it (would be suppressing a harmless signal).

## Change

Group **all non-code (infrastructure) dependency updates** into a single weekly
manual-merge PR (`renovate/all-non-code-dependencies`), instead of a flood of
individual PRs.

### Design decisions (confirmed with user)

- **Scope: fold in everything non-code**, including the previously carve-out'd
  critical infra (talos, kubernetes, siderolabs/installer, paper), prod images
  (scout-for-lol/prod, starlight-karma-bot/prod), and minecraft.
- **Manual merge** (not auto-merge): the grouped PR is a weekly review checkpoint.

### `renovate.json` edits

| Edit                  | Detail                                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add group rule        | `matchDatasources`: `docker, helm, terraform-provider, github-releases, github-tags, git-refs, node-version, golang-version, java-version, rust-version, custom.papermc` → `groupName: "all non-code dependencies"`, `automerge: false`  |
| Trim carve-outs       | Removed `schedule: ["at any time"]` from critical-infra / prod / minecraft rules so they ride the group's weekly cadence. Kept `minimumReleaseAge: "0 days"` so they're eligible for the next weekly PR without the 30-day global delay. |
| Remove OpenTofu group | Standalone `OpenTofu` groupName deleted — TOFU_IMAGE (docker) + TOFU_VERSION (github-releases) now co-locate in the infra group's single PR, preserving "bump together".                                                                 |

### Datasource split (from the live 17:43 run)

- **Code (excluded, unchanged):** `npm` (1053), `go` (53), `crate` (21), `nuget` (5), `pypi` (3) — keep individual PRs / React / Node.js-major / cdk8s groups.
- **Non-code (grouped):** `docker` (134), `github-releases` (71), `terraform-provider` (39), `helm` (39), `github-tags` (14), toolchain `*-version` pins, `git-refs` (3), `custom.papermc`.

## Verification

- `renovate-config-validator` → "Config validated successfully".
- JSON syntax valid.
- Cannot fully dry-run grouping locally (needs a real Mend run); logic verified against
  Renovate packageRule merge semantics (later rule wins per-field; carve-out rules set no
  groupName so they inherit the infra group).

## Caveats / follow-up

- **Prod-image cadence:** scout-for-lol/prod and karma/prod bumps are now **batched
  weekly** rather than surfacing as immediate individual PRs. If Renovate is the prod
  deploy mechanism, this slows prod rollouts to weekly — watch for this; easy to carve
  prod back out (own group + `schedule: ["at any time"]`) if it bites.
- **Cluster-version cadence:** talos / kubernetes bumps likewise batch weekly now.
- First grouped PR after merge will be large (backlog of eligible infra updates); expect
  to review a sizeable bundle once.
