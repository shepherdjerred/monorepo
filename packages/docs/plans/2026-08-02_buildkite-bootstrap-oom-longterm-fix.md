---
id: plan-2026-08-02-buildkite-bootstrap-oom-longterm-fix
type: plan
status: in-progress
board: false
---

# Buildkite bootstrap `pipeline-upload` OOM — long-term fix

## Context

Every PR has been red since 2026-08-02 19:18 UTC: the bootstrap `pipeline-upload` step is memcg-OOM-killed (exit `-7`) before it can upload any steps. Diagnosed chain (full evidence: `packages/docs/logs/2026-08-02_buildkite-pipeline-upload-oom-diagnosis.md`):

1. The tofu-managed bootstrap pod (`packages/homelab/src/tofu/buildkite/pipeline.tf:35-64`) patches only the `checkout` container — `container-0` lacks the `buildkite-git-mirrors` mount, so the checkout's `.git/objects/info/alternates` is unreadable there and `upload-pipeline.sh`'s base fetch silently downloads the **entire repo pack (~693 MiB)** every build.
2. `container-0` has no explicit resources → the namespace LimitRange (`buildkite.ts:103-120`, intentional fail-safe) defaults its memory limit to **768Mi**; the workspace is tmpfs, so pack bytes are shmem charged to that limit.
3. Repo pack outgrew the margin on Aug 2 (654→693 MiB) → OOM on every full fetch.

Goal: fix the mount + resources, and make each latent layer impossible to regress silently (loud script guard, enforced contract in CI, docs).

## Changes (one PR, one worktree)

| #   | File                                                                                       | Change                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/homelab/src/tofu/buildkite/pipeline.tf:35-64`                                    | Add `container-0` to the bootstrap `podSpecPatch`: git-mirrors mount + explicit resources (pod_light shape)                                                                                                            |
| 2   | `.buildkite/scripts/upload-pipeline.sh`                                                    | Alternates-health guard: broken/missing mirror → loud `fail_open`, never a giant fetch                                                                                                                                 |
| 3   | `.buildkite/scripts/upload-pipeline.test.sh`                                               | Two new cases: healthy alternates pass through; broken alternates fail open with WARN                                                                                                                                  |
| 4   | `.buildkite/scripts/validate-pipeline-release.ts` (`validateSelectorAndUpload`, ~line 173) | Enforce the bootstrap contract in `verify` so neither fix can be silently removed                                                                                                                                      |
| 5   | `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts:94-102`           | One-sentence LimitRange comment addendum referencing this incident (comment only, no manifest diff)                                                                                                                    |
| 6   | `packages/homelab/src/tofu/.env`                                                           | Add `BUILDKITE_API_TOKEN=op://…` reference line (op-ref, not a secret) for operator applies                                                                                                                            |
| 7   | Skill + docs                                                                               | buildkite-helper gotcha bullet (dual edit: `packages/dotfiles/dot_agents/skills/buildkite-helper/SKILL.md` + live `~/.claude/skills/…`); move + finish the diagnosis log; mirror this plan into `packages/docs/plans/` |

### 1. `pipeline.tf` — bootstrap container-0 patch

Append to the existing `podSpecPatch.containers` (keep the `checkout` entry and the `sh .buildkite/scripts/upload-pipeline.sh` literal — existing validator contract):

```yaml
- name: container-0
  # Runs upload-pipeline.sh. The checkout is a reference clone against the
  # shared git mirror; without this mount every git op degrades to a
  # full-repo pack download into the tmpfs workspace, which the namespace
  # LimitRange's 768Mi default then OOM-kills (fleet-wide red PRs
  # 2026-08-02; see packages/docs/logs/2026-08-02_buildkite-pipeline-upload-oom-diagnosis.md).
  # Resources copy the pod_light container-0 shape so the LimitRange
  # default can never apply and even a full-pack-fetch regression fits.
  # Do NOT add secret env sources here: pipeline upload interpolates $VAR
  # at upload time and would bake secret values into the stored pipeline.
  # Do NOT pin a CI image: it is computed BY this step; the default agent
  # image (git + buildkite-agent) is sufficient.
  resources:
    requests: { cpu: 250m, memory: 512Mi, ephemeral-storage: 1Gi }
    limits: { cpu: "7", memory: 12Gi, ephemeral-storage: 20Gi }
  volumeMounts:
    # Pod-level volume is injected for every job by the agent stack's
    # default-checkout-params.gitMirrors.
    - name: buildkite-git-mirrors
      mountPath: /buildkite/git-mirrors
      readOnly: true
```

Sizing: requests = smallest canonical tier (real cost); limits are burst caps — 12Gi gives ~15× headroom over today's 693 MiB pack so a future mirror regression can never re-create this outage. Comment wording must avoid the literal tokens the new validator forbids (`envFrom`, `image:`, secret-name) — see Change 4.

### 2. `upload-pipeline.sh` — alternates guard

Insert after the `write_changed_files` definition (line 61), before the branch chain; then make it the chain's first branch:

```sh
# Mirror-health guard (2026-08-02 incident): if the mirror volume backing the
# checkout's alternates is missing/unreadable, git silently falls back to
# fetching the entire repository pack into the memory-backed workspace and
# the container is OOM-killed. Degrade loudly to scheduling every lane.
broken_alternate=""
alternates_file=$(git rev-parse --git-path objects/info/alternates)
objects_dir=$(git rev-parse --git-path objects)
if [ -f "$alternates_file" ]; then
  while IFS= read -r alternate || [ -n "$alternate" ]; do
    case "$alternate" in
      "" | "#"*) continue ;;
      /*) alternate_dir=$alternate ;;
      *) alternate_dir="$objects_dir/$alternate" ;;
    esac
    if [ ! -d "$alternate_dir" ] || [ ! -r "$alternate_dir" ]; then
      broken_alternate=$alternate_dir
      break
    fi
  done < "$alternates_file"
fi

if [ -n "$broken_alternate" ]; then
  fail_open "git alternate object directory ${broken_alternate} is not readable (git-mirrors volume missing?)"
elif [ -n "${CI_CHANGED_FILES_BASE:-}" ]; then
  …existing chain unchanged…
```

No alternates file = healthy full clone = fine. Relative entries resolve against the objects dir (git semantics). Passes shellcheck (`read -r`, quoted, redirect-into-while) and the banned-pattern scanner (no `|| true` / `2>/dev/null`).

### 3. `upload-pipeline.test.sh` — new cases

Insert **between** the fail-open test (ends line 69) and the invalid-digest test (line 71 must stay last — it corrupts the fixture DIGEST without restoring):

- Healthy alternates: write `.git/objects/info/alternates` with a comment line, blank line, absolute entry (`$FIXTURE/mirror-a`) and relative entry (`../../mirror-b`, dirs created); run with `CI_CHANGED_FILES_BASE="$BASE"`; assert captured changed-files equals `$expected` (guard must not trip).
- Broken alternates: write a single `/nonexistent/...` entry; run with stderr to a file; assert captured changed-files is exactly `.buildkite/pipeline.yml` and stderr contains `alternate object directory`. Remove the alternates file afterward.

Reuse the existing fixture/fake-agent harness verbatim (`CAPTURE_PATH` / `CI_*_CAPTURE` env pattern, lines 37-42). No wiring changes — already run via `scripts/package.json` test and `scripts/ci-test-manifest.json:336`.

### 4. `validate-pipeline-release.ts` — contract extension

In `validateSelectorAndUpload()` after the existing `tofuPipeline` checks, matching the file's substring style:

- Slice the heredoc's `- name: container-0` block (from that marker to the next `- name:`); require: `resources:`, `limits:`, `memory:`, `name: buildkite-git-mirrors`, `mountPath: /buildkite/git-mirrors`, `readOnly: true`.
- Whole-file negative assertions on `pipeline.tf`: forbid `envFrom`, `secretRef`, `buildkite-ci-secrets`, `image:` (upload-time interpolation hazard / image-not-yet-computed). Current file contains none; Change 1's comments are worded to keep it that way.
- Add `objects/info/alternates` to the `uploadPipeline` required-token loop (note: the script uses `git rev-parse --git-path objects/info/alternates`, so do NOT assert a `.git/`-prefixed form) so the guard can't be silently dropped.

### 5–7. Small touches

- `buildkite.ts:94-102`: append to the LimitRange comment: the 768Mi default OOM-killed the tofu bootstrap pod when container-0 had no explicit resources (2026-08-02); fix containers explicitly — don't raise/remove the default.
- `.env`: add `BUILDKITE_API_TOKEN=op://<vault>/<item>/<field>` — locate the existing 1Password field with a single batched `op` query; never create/rename 1P items. `tofu-stack.ts:60` already maps it to `TF_VAR_buildkite_api_token`.
- buildkite-helper skill (chezmoi source + live copy): one bullet — agent exit `-7` "stopped communicating" + post-mortem Job `DeadlineExceeded` are red herrings for a container memcg OOM; cgroup OOM kills emit **no** k8s events — check the node kernel log (`kubectl debug node`); tmpfs workspace bytes count against the writing container's memory limit.
- Docs: move the untracked diagnosis log into the worktree (repo rule) and update its Remaining section; copy this plan to `packages/docs/plans/2026-08-02_buildkite-bootstrap-oom-longterm-fix.md` (canonical frontmatter) at implementation start.

## Rollout sequence

1. Worktree per repo rules: `git worktree add .claude/worktrees/buildkite-bootstrap-oom -b fix/buildkite-bootstrap-oom origin/main`; `gh stack init --base main fix/buildkite-bootstrap-oom`; `mise install && bun install --frozen-lockfile && bunx turbo run generate && bunx lefthook install`. Move the untracked docs log in.
2. Make Changes 1–7.
3. Local verification (worktree root):
   - `bash .buildkite/scripts/upload-pipeline.test.sh`
   - `bun scripts/shellcheck.ts`
   - `bun .buildkite/scripts/validate-pipeline.ts` (proves new assertions pass and don't self-trip)
   - `tofu -chdir=packages/homelab/src/tofu/buildkite init -backend=false && tofu … validate` (HCL syntax only; the validator is the YAML guard)
4. **Operator apply first** (CI is broken by this very bug, so the fix can't ride a green PR; PR #1926 touches only the `github` stack — no state conflict):
   - `op run --env-file=packages/homelab/src/tofu/.env -- bun packages/homelab/scripts/tofu-stack.ts buildkite plan`
   - **Plan gate:** expect exactly one in-place change (`buildkite_pipeline.monorepo` `steps`). Anything else → stop and investigate.
   - `… tofu-stack.ts buildkite apply`
5. Retry a red PR build; verify (see below); push the PR (draft → ready), merge when green.
6. Main convergence: merge triggers the `tofu-apply` lane (buildkite stack in its list) → expect a no-op apply. Confirm in the main build log.
7. Post-merge: archive plan/log per docs discipline; worktree cleanup via the owning stack skill.

## Verification

- Fresh `pipeline-upload` log: **no** `unable to normalize alternate object path`; fetch is a small delta (not ~693 MiB); exit 0.
- `kubectl get job -n buildkite -l ci.sjer.red/step-key=pipeline-upload -o yaml`: container-0 shows 512Mi/12Gi + the mirror mount; no secret env sources.
- `bash .buildkite/scripts/upload-pipeline.test.sh` green locally; `verify` step green in CI (validator additions).
- Simulated regression (optional, local fixture): alternates → nonexistent dir ⇒ WARN + full-lane schedule (covered by new test).

## Risks

- **Revert window:** between the operator apply and the PR merge, another main merge touching tofu inputs re-applies main's unfixed heredoc. Bounded: merge promptly; if reverted, re-run the local apply.
- **Validator self-trip:** heredoc comments must avoid the forbidden literals — step 3's local validator run catches it.
- **Guard scope:** readability-only; a mounted-but-stale mirror still fetches a delta (normal), and git-abort cases already hit existing `fail_open` branches. Residual big-fetch worst case fits in 12Gi.
- Separate red builds observed during diagnosis (review-gate, one argocd-sync, release-please) are **out of scope** — pre-existing threads, not this outage.
