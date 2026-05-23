# GitHub App Automation Research

## Status

Complete

## Summary

Audited the GitHub-related automation surfaces that still use static tokens and researched whether GitHub App installation tokens can replace them.

The main conclusion is that release creation/upload, git push automation, and OpenTofu GitHub provider automation can move to GitHub App installation tokens. GitHub Packages/GHCR publish is the uncertain surface because GitHub's registry documentation still emphasizes the built-in GitHub Actions token or PAT classic for CLI/registry login, while GitHub App installation tokens are clearly supported for many REST package endpoints. The implementation reused the current GitHub App as requested, so that app needs the release and infra permissions listed in the plan.

## Findings

- PR/review/comment automation is mostly app-backed already through `packages/temporal/src/lib/github-app-token.ts`, Buildkite scripts, and Dagger `withGithubAppToken`.
- The implementation follow-up moved `packages/temporal/src/event-bridge/github-webhook.ts` to a minted GitHub App token.
- The implementation follow-up moved the active Cooklang release path in `.dagger/src/release.ts` to minted GitHub App tokens; the Clauderon upload surface was removed on `main` before this branch rebased, so it is no longer an active automation path in this repo.
- External Cooklang repo push can use a GitHub App if the app is installed on that external repo with contents write permission.
- GHCR/package publishing needs a live compatibility matrix before migration because Docker/OCI registry authentication is not the same surface as the REST Packages API.
- OpenTofu/GitHub-provider automation now uses the same app credentials; the app permissions must cover the repository resources managed in `packages/homelab/src/tofu/github`.

## Session Log - 2026-05-23

### Done

- Loaded the relevant deep-research and GitHub skills.
- Searched prior local context with `toolkit recall search`.
- Fetched/reviewed GitHub documentation for App installation tokens, REST endpoint permissions, releases, packages, container registry authentication, and `gh` token environment behavior.
- Mapped those findings back to the repo's release, package, PR automation, webhook, and infra token surfaces.

### Remaining

- Change `packages/temporal/src/event-bridge/github-webhook.ts` to use the GitHub App token helper for the draft-skipped status comment.
- Migrate Cooklang and any active Clauderon release paths to app tokens after confirming the release app permissions.
- Run a disposable GHCR publish test with an installation token before changing package publishing CI.
- Verify the exact Terraform/OpenTofu GitHub provider app-auth syntax and create a separately scoped infra app migration plan.

<!-- temporal-agent-task
{
  "title": "Validate GitHub App automation research follow-ups",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-05-30T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/logs/2026-05-23_github-app-automation-research.md"
  },
  "prompt": "Review the GitHub App automation research Remaining section. Report which follow-ups are complete, which still need operator action, and include evidence for GHCR auth and OpenTofu GitHub provider auth."
}
-->

### Caveats

- Terraform Registry content fetch returned empty via the local fetch tool, so provider-specific syntax should be verified against the provider docs or source before implementation.
- No repo code was changed during this research pass.

## Session Log - 2026-05-23 Implementation

### Done

- Migrated the active Dagger Cooklang release helper from long-lived `GH_TOKEN` secrets to GitHub App installation tokens; after rebasing onto current `main`, no Clauderon upload helper remains to migrate.
- Migrated OpenTofu GitHub provider auth to `app_auth {}` with GitHub App environment variables and removed `TOFU_GITHUB_TOKEN` from Buildkite Tofu steps.
- Renamed GHCR image publishing auth in CI from `GH_TOKEN` to `GHCR_TOKEN` and documented GHCR as the only GitHub PAT exception.
- Migrated Temporal webhook status posting, agent-task repo cloning/subprocess auth, homelab audit subprocess auth, dependency release-note fetches, and PR-review eval fixture cloning to minted GitHub App tokens.
- Removed `GH_TOKEN` from the Temporal worker environment and updated Temporal docs.
- Added CI generator assertions for GitHub App release/Tofu auth and GHCR-only registry auth.

### Remaining

- Provision or rename the Buildkite/1Password registry secret as `GHCR_TOKEN`.
- Ensure the reused GitHub App has the required permissions and repository installation coverage before merge-time release/Tofu jobs run.
- Run a real OpenTofu backend init/plan with S3 backend credentials and real app credentials in the operator environment.

<!-- temporal-agent-task
{
  "title": "Recheck GitHub App rollout prerequisites",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-05-31T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/logs/2026-05-23_github-app-automation-research.md"
  },
  "prompt": "Check the GitHub App automation implementation Remaining section. Report whether GHCR_TOKEN exists for Buildkite registry publishing, whether the reused GitHub App has the required permissions and repo installation coverage, and whether a real OpenTofu backend init/plan has been validated with app credentials."
}
-->

### Caveats

- Local `tofu init` with the real backend failed because this shell does not have S3 backend credentials.
- Backendless OpenTofu init and provider validation passed with dummy GitHub App env vars.
- Dagger module validation required elevated access to the local OrbStack/Docker socket.
