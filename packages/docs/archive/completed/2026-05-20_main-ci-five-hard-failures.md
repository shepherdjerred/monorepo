# Why is CI on main failing

## Status

**Complete** — all plan-scoped work verified shipped to `main` during the 2026-06-06 docs groom; archived to `archive/completed/`. Original tracking status preserved below.

In Progress — PR covers Fix 6.b + Fix 7; secret rotations (`GITHUB_APP_PRIVATE_KEY`,
`NPM_TOKEN`) remain user-owned and unblock the remaining 3 hard failures.

## Context

Buildkite [#2630 on `main`](https://buildkite.com/sjerred/monorepo/builds/2630) is
in state `failing`. The triggering commit (`9aa58846 chore: bump ci-base image
to 407`) is **not** the cause — the same 7 jobs failed on the prior `main`
build [#2622](https://buildkite.com/sjerred/monorepo/builds/2622). The image
bump just runs again and trips the same wires.

5 of the 7 failures are hard fails that gate the build; 2 are configured
`soft_fail` and don't change build state (they just paint red in the UI).
Each failure has a different root cause and a different fix.

## TL;DR — the 7 red jobs

| #   | Job                                            | Hard? | Root cause (file:line)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Fix                                                                                                                                                                           |
| --- | ---------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | :scissors: Knip                                | soft  | Reports unused exports/types across many packages — expected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Triage report; no action required for green CI                                                                                                                                |
| 2   | :shield: Trivy                                 | soft  | CRITICAL CVE-2026-44990 in `sanitize-html` 2.17.3 (no upstream fix yet)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Add `CVE-2026-44990` to `.trivyignore` with a "no fix available" note, or wait for upstream                                                                                   |
| 3   | :bookmark: Release Please                      | hard  | `crypto.subtle.importKey` rejects `GITHUB_APP_PRIVATE_KEY` ("Data provided to an operation does not meet requirements") — [`github-app-token.ts:81-95`](packages/temporal/src/lib/github-app-token.ts:81). The key passes the PEM-header regex check but is rejected by WebCrypto, so it's PKCS#1 (RSA-flavored header) being normalized to look like PKCS#8, mangled base64, or stripped newlines                                                                                                                                                                                                                                                                                                   | Re-upload `GITHUB_APP_PRIVATE_KEY` to 1Password/Buildkite as a clean PKCS#8 PEM. Verify by running `bun packages/temporal/src/lib/github-app-token.ts` locally with `op run`. |
| 4   | :npm: Publish webring (dev)                    | hard  | `404 Not Found: https://registry.npmjs.org/webring` from `bun publish` — but the package exists (200 via curl). npm returns 404 instead of 401/403 on auth failures to avoid leaking package existence. Last successful publish was 2026-05-19 15:53 UTC (build #2595); broken on every build since                                                                                                                                                                                                                                                                                                                                                                                                  | Re-issue the `NPM_TOKEN` (likely expired or scope-restricted), update the Buildkite/1Password secret, retry                                                                   |
| 5   | :npm: Publish astro-opengraph-images (dev)     | hard  | Same root cause as #4 — same shared `NPM_TOKEN`. Last successful publish: 2026-05-19 15:54 UTC                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Same fix as #4                                                                                                                                                                |
| 6   | :npm: Publish @shepherdjerred/helm-types (dev) | hard  | **Two stacked bugs:** (a) Same `NPM_TOKEN` issue as #4/#5 (last good publish: 2026-05-17 22:32 UTC). (b) **Catalog key mismatch** — [`scripts/ci/src/steps/npm.ts:24`](scripts/ci/src/steps/npm.ts:24) does `WORKSPACE_DEPS[pkg.name]` with `pkg.name = "@shepherdjerred/helm-types"`, but [`.dagger/src/deps.ts:43`](.dagger/src/deps.ts:43) keys it as `"homelab/src/helm-types"`. Result: no `--dep-names eslint-config` passed → `eslint-config` not mounted into the publish container → `bun install --frozen-lockfile` fails with `ENOENT: failed opening cache/package/version dir for package @shepherdjerred/eslint-config` (the `file:../../../eslint-config` resolves to a missing path) | Fix the catalog key — see "Fix 6" below                                                                                                                                       |
| 7   | :cook: Publish cooklang plugin                 | hard  | [`scripts/ci/src/steps/cooklang.ts:35`](scripts/ci/src/steps/cooklang.ts:35) passes `--plugin-repo "$COOKLANG_PLUGIN_REPO"` but **`COOKLANG_PLUGIN_REPO` is never set anywhere** (`grep -r` finds it in exactly one place — that command). Expands to empty string → Dagger throws `pluginRepo must be a GitHub owner/repo slug`. Regression from commit `aeebe5cc6` (2026-05-19 "remove stale shepherdjerred repo references") that replaced the hardcoded constant `COOKLANG_PLUGIN_REPO = "shepherdjerred/cooklang-for-obsidian"` with a required arg but didn't pipe in a value                                                                                                                  | Hardcode the repo back in `cooklang.ts:35` (`--plugin-repo shepherdjerred/cooklang-for-obsidian`) or add the env var to the Buildkite pipeline — see "Fix 7" below            |

## Scope of this PR

**Code fixes only — secrets are out of scope.** Per user direction, this PR
addresses the two breakages that are committable code changes:

- **Fix 6.b** — helm-types catalog key in `.dagger/src/deps.ts`
- **Fix 7** — cooklang plugin-repo hardcode in `scripts/ci/src/steps/cooklang.ts`

After this PR merges, the Release Please job, the webring and
astro-opengraph-images publishes, and the `bun publish` step of helm-types
will **still be red** until `GITHUB_APP_PRIVATE_KEY` and `NPM_TOKEN` are
re-issued separately by the user. The diagnostics for those (below) remain in
the plan for reference only.

### The PR — two changes

**1. `.dagger/src/deps.ts:43`**

```diff
-  "homelab/src/helm-types": ["eslint-config"],
+  "@shepherdjerred/helm-types": ["eslint-config"],
```

Verify the other consumer of `WORKSPACE_DEPS` (deploy-site step generator)
still works; if it keys by directory name instead of npm name, add both
entries (alias) rather than swap.

**2. `scripts/ci/src/steps/cooklang.ts:35`**

```diff
-        command: `dagger call cooklang-build-and-publish --source . ${COOKLANG_PKG_FLAGS} --gh-token env:GH_TOKEN --plugin-repo "$COOKLANG_PLUGIN_REPO" ${GITHUB_APP_SECRET_ARGS}${DRYRUN_FLAG}`,
+        command: `dagger call cooklang-build-and-publish --source . ${COOKLANG_PKG_FLAGS} --gh-token env:GH_TOKEN --plugin-repo shepherdjerred/cooklang-for-obsidian ${GITHUB_APP_SECRET_ARGS}${DRYRUN_FLAG}`,
```

### Verification before opening the PR

```bash
# Regenerate the CI pipeline JSON to confirm cooklang step has a literal
# --plugin-repo arg (not "$COOKLANG_PLUGIN_REPO")
cd scripts/ci && bun run src/main.ts | grep -A1 "cooklang-publish" | grep plugin-repo

# Spot-check helm-types step generator picks up eslint-config via the new key
cd scripts/ci && bun run src/main.ts | grep -A2 "npm-@shepherdjerred-helm-types" | grep dep-names

# Typecheck both touched packages
bun run --filter='./scripts/ci' typecheck
bun run --filter='./.dagger' typecheck
```

### After the PR merges

Main CI will go from 5 hard failures to 3 (Release Please, two npm publishes).
Knip and Trivy stay soft. The remaining 3 are unblocked by re-issuing the two
secrets — see the read-only diagnostics below for what to check when rotating.

---

## Diagnostics for the out-of-scope failures (reference only)

### Fix 3 — Release Please (re-upload `GITHUB_APP_PRIVATE_KEY`)

The script `packages/temporal/src/lib/github-app-token.ts` only accepts a
**PKCS#8** PEM (a PKCS#8 BEGIN header (no `RSA` qualifier)). The WebCrypto importKey call
on line 88 throws `DOMException: Data provided to an operation does not meet
requirements` when the key bytes don't parse as PKCS#8 RSA. Three things to
check when re-uploading to 1Password / Buildkite:

1. PEM header is the PKCS#8 form (the BEGIN line has no `RSA` qualifier), not
   the PKCS#1 form (RSA-flavored BEGIN). If the GitHub App download gave you a PKCS#1 file,
   convert: `openssl pkcs8 -topk8 -nocrypt -in pkcs1.pem -out pkcs8.pem`.
2. No double-encoding (per the user's `reference_1password_double_encoding.md`
   memory — strip any leading `eyJ`).
3. Literal newlines preserved — `normalizePrivateKey` does
   `.replaceAll("\\n", "\n")` so escaped `\n` is fine, but check for stripped
   PEM BEGIN/END markers from copy/paste.

Verify locally before committing:

```bash
op run --env-file=packages/temporal/.env.audit -- \
  bun packages/temporal/src/lib/github-app-token.ts >/dev/null && echo OK
```

### Fix 4 + 5 — `NPM_TOKEN`

Same fix for both webring and astro-opengraph-images: re-issue the token at
<https://www.npmjs.com/settings/shepherdjerred/tokens>, update the 1Password
item, push to Buildkite secrets. Confirm via:

```bash
echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > /tmp/.npmrc.test
cd packages/webring && bun publish --dry-run --userconfig /tmp/.npmrc.test
```

### Fix 6 — helm-types catalog key

Change [`.dagger/src/deps.ts:43`](.dagger/src/deps.ts:43):

```diff
-  "homelab/src/helm-types": ["eslint-config"],
+  "@shepherdjerred/helm-types": ["eslint-config"],
```

The map is consumed by **two** call sites — `scripts/ci/src/steps/npm.ts:24`
(uses `pkg.name` = npm package name) and the deploy-site step generator (uses
directory name). Check the second call site doesn't break before flipping the
key. If both keys are needed, alias them.

After this fix the `NPM_TOKEN` issue (#6.a) still has to be solved, so order
the fixes: token first → helm-types catalog → retry job.

### Fix 7 — cooklang plugin repo

The cleanest revert of the regression in `aeebe5cc6`. In
[`scripts/ci/src/steps/cooklang.ts:35`](scripts/ci/src/steps/cooklang.ts:35):

```diff
-        command: `dagger call cooklang-build-and-publish --source . ${COOKLANG_PKG_FLAGS} --gh-token env:GH_TOKEN --plugin-repo "$COOKLANG_PLUGIN_REPO" ${GITHUB_APP_SECRET_ARGS}${DRYRUN_FLAG}`,
+        command: `dagger call cooklang-build-and-publish --source . ${COOKLANG_PKG_FLAGS} --gh-token env:GH_TOKEN --plugin-repo shepherdjerred/cooklang-for-obsidian ${GITHUB_APP_SECRET_ARGS}${DRYRUN_FLAG}`,
```

(That `aeebe5cc6` commit removed the same hardcoded slug in `.dagger/src/release.ts` claiming it was "stale" — but the slug is the actual live cooklang plugin repo, so it's still correct. The refactor was incomplete: the
value needed to flow from somewhere, and nothing was wired up.)

### Soft failures (Knip, Trivy) — optional polish

- Knip: large output (62 KiB artifact). Triage in a follow-up PR; not blocking.
- Trivy: add CVE-2026-44990 to `.trivyignore` with a comment when no upstream
  fix lands, otherwise wait. Other entries in the trivy output are HIGH and
  already non-blocking.

## Why these all stacked up on main

| Failure                           | First red build                     | Cause                                                                                                                                 |
| --------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| helm-types publish                | between #2588 and #2592 (May 17-18) | Older — likely the WORKSPACE_DEPS key never matched after the catalog refactor that scoped helm-types to `@shepherdjerred/helm-types` |
| webring / astro-opengraph publish | between #2595 and #2622 (May 19+)   | NPM_TOKEN stopped working                                                                                                             |
| Release Please                    | seen in #2622 and #2630             | GITHUB_APP_PRIVATE_KEY became invalid                                                                                                 |
| cooklang plugin                   | starting #2622                      | Regression in `aeebe5cc6` (2026-05-19)                                                                                                |
| Knip / Trivy                      | always — by design `soft_fail`      | Not the issue                                                                                                                         |

No single commit caused this — three separate breakages landed within ~3 days
and have been red on every main build since.

## End-to-end verification for this PR

1. Open the PR; the PR build runs with `DRYRUN_FLAG` set, so cooklang's
   dagger call exercises the validation path with the new literal slug and
   should pass instead of throwing `pluginRepo must be a GitHub owner/repo slug`.
2. After merge, monitor the first `main` build: jobs `cooklang-publish` and
   `npm-@shepherdjerred-helm-types` should now go past their current failure
   modes. (helm-types may still fail on `bun publish` until NPM_TOKEN is
   rotated — that's expected and out of this PR's scope.)
3. `bk build view -b main` to confirm state movement.

## Out of scope (do separately)

- Knip cleanup of the ~60+ unused exports/types — separate PR per package owner.
- Trivy ignore list pruning — separate hardening pass.
- Re-evaluating whether `npm publish` should fail-soft on auth errors (it
  shouldn't, but better error messages would have saved an hour today).
