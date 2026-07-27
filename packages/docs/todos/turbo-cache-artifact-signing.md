---
id: turbo-cache-artifact-signing
type: todo
status: planned
board: true
verification: agent
disposition: deferred
origin: packages/docs/archive/completed/turbo-cache-rollout.md
source_marker: false
---

# Decide whether to sign turbo remote-cache artifacts

Artifact signing is an optional hardening decision, not part of proving the
deployed cache works.

## Remaining

- [ ] Document the threat model, key-distribution cost, rotation path, and failure behavior for `remoteCache.signature`.
- [ ] Decide whether the risk justifies a shared `TURBO_REMOTE_CACHE_SIGNATURE_KEY` on every client and the server.
- [ ] If adopted, implement signing with a rotation-safe rollout and deterministic cache-hit verification; otherwise record the decision and archive this todo.
