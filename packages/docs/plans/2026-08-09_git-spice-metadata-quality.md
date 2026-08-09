---
id: git-spice-metadata-quality-2026-08-09
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Improve Git Spice Commit and PR Metadata

## Summary

Define a clear metadata contract so every commit is meaningful and every PR
accurately describes the complete branch diff. Agents compose PR titles and
bodies explicitly instead of blindly relying on `git-spice --fill`.

## Implementation

- Update `AGENTS.md` with an objective pre-submit checklist for commit subjects,
  primary commit bodies, PR titles, PR bodies, verification evidence, and visual
  artifacts.
- Update the tracked Git Spice skill and worked workflows to make the complete
  branch diff the source for PR metadata, document multi-commit branches, and
  show explicit title/body submission with a dry-run inspection.
- Treat `--fill` as an optional draft or diagnostic. Use `--update-only` after
  review changes so follow-up commits do not overwrite the narrative PR body.
- Keep the commit hook and automated validation unchanged; enforcement is the
  deterministic agent checklist and explicit submit workflow.

## Verification

- Confirm no guidance presents `git-spice --fill` as sufficient final metadata.
- Run focused Prettier/Markdown checks and the staged pre-commit hook.
- Exercise Git Spice dry-run and explicit title/body command forms without
  publishing a PR.
- Verify single-commit, multi-commit, stacked, and review-follow-up workflows
  are all covered.

## Remaining

- [ ] Publish the guidance changes through a Git Spice PR and verify the workflow
      with a real submission.
