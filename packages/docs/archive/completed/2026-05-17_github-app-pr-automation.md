---
id: reference-completed-2026-05-17-github-app-pr-automation
type: reference
status: complete
board: false
---

# GitHub App PR Automation

## Summary

Move automated PR and review actions from static GitHub user tokens to short-lived GitHub App installation tokens so visible GitHub actions are attributed to the app bot account.

## Plan

- Add a Bun-native GitHub App installation token helper that reads `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY`, signs an app JWT, exchanges it for an installation access token, validates the response, and prints only the token when run as a CLI.
- Use the app token for PR/review/comment surfaces in Buildkite scripts, Dagger commit-back/release-please PR operations, and Temporal PR review/summary/generated-PR activities.
- Keep `GH_TOKEN` for non-PR GitHub operations such as registry/package publishing until those surfaces are separately verified.
- Wire the new secret fields into the Temporal worker environment and document them in `packages/temporal/AGENTS.md`.
- Verify with focused helper tests, Temporal tests, Dagger/script generation checks, and shell syntax checks.

## Acceptance Criteria

- PR creation, PR review, PR summary/comment posting, and generated PR pushes use installation tokens derived from the GitHub App credentials.
- Missing app credentials fail fast with clear errors on PR/review automation paths.
- Existing generated commit author metadata remains explicit.
- `GH_TOKEN` remains available where existing publishing or infrastructure code still requires it.
