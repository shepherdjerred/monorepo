---
id: log-2026-07-28-buildkite-artifact-upload-audit
type: log
status: complete
board: false
---

# Buildkite artifact upload audit

## Question

Determine whether the current static Buildkite pipeline uploads code coverage,
unit-test reports, lint reports, binaries, or other build outputs to Buildkite.

## Findings

The pipeline uploads selected build and diagnostic artifacts, but it does not
upload quality reports.

| Category                        | Buildkite artifact status                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code coverage                   | Not uploaded. Script coverage emits text, and Scout can generate LCOV, but no coverage path is declared as an artifact.                                        |
| Unit-test reports               | Not uploaded. Tests write results to job logs; there is no active JUnit or Buildkite Test Engine reporter wiring.                                              |
| Lint reports                    | Not uploaded. Lint output remains in job logs; there is no SARIF, Checkstyle, or equivalent report artifact.                                                   |
| Standalone binaries or archives | Not uploaded as a general category. Container images, npm packages, Helm charts, and site releases publish to their destination registries or storage instead. |
| Generated/deployable outputs    | Uploaded selectively: the sjer.red static bundle on main, resume PDFs, synthesized cdk8s manifests, and a generated Caddyfile.                                 |
| CI diagnostics                  | Image-selection and image-push outcome JSON files are uploaded. Turbo and build summaries are Buildkite annotations rather than artifacts.                     |

The artifact declarations in `.buildkite/pipeline.yml` are:

- `caddyfile.generated` and `packages/homelab/src/cdk8s/dist/**` from `verify`
- `packages/sjer.red/dist/**` from the main Playwright lane
- `packages/resume/*.pdf` from the PR and main resume lanes
- `image-selection-report.json` from PR and main image lanes
- `image-push-outcomes.json` from the main image lane

Live verification against main build
[#6749](https://buildkite.com/sjerred/monorepo/builds/6749) found 413 artifacts:
378 sjer.red site files, 31 cdk8s manifests, one resume PDF, one generated
Caddyfile, and two image diagnostic JSON files. No artifact path matched
coverage, test-result, JUnit, lint, SARIF, LCOV, or Cobertura report patterns.

## Session Log — 2026-07-28

### Done

- Refreshed `origin/main` and confirmed the checkout and remote pipeline commit
  are both `b2bc4e53a1b939292e9daecb6830491224ed8d7e`.
- Audited every Buildkite artifact declaration and artifact transfer in
  `.buildkite/pipeline.yml`.
- Searched active CI scripts and package configuration for coverage, unit-test,
  lint, and Buildkite Test Engine reporter wiring.
- Verified the configured behavior against the live artifact inventory for main
  build #6749.

### Remaining

- None; this was a read-only audit.

### Caveats

- Build #6749 failed in a later pipeline lane, but its artifact-producing jobs
  completed and uploaded the inventory used here.
- Other untracked session logs already present in the main checkout were not
  modified.
