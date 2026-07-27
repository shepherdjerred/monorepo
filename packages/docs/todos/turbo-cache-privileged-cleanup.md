---
id: turbo-cache-privileged-cleanup
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/archive/completed/turbo-cache-rollout.md
source_marker: false
---

# Remove obsolete turbo-cache credentials and excess R2 permission

The local-cache cutover shipped in PR #1696. These cleanup operations mutate
1Password and Cloudflare credentials and therefore require explicit operator
authorization.

## Remaining

- [ ] After applying the current dotfiles, confirm the development `TURBO_TOKEN` is sourced from `buildkite-ci-secrets`.
- [ ] Obtain authorization to delete the unused `turbo-cache-r2` 1Password item, then refresh the committed vault snapshot.
- [ ] Confirm a post-merge Cloudflare apply destroyed the old bucket before obtaining authorization to revoke **Workers R2 Storage → Edit** from the Tofu token.
- [ ] Record the item deletion, snapshot refresh, and permission state; then archive this record.
