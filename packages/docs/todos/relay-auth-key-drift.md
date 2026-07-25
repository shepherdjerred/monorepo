---
id: relay-auth-key-drift
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-07-04_homelab-relay-server.md
source_marker: true
---

# Relay auth public keys must stay in sync with the image on every upgrade

The `[[auth]]` Ed25519 **public** keys embedded in the mounted `relay.toml`
ConfigMap (`packages/homelab/src/cdk8s/src/resources/relay/index.ts`,
`AUTH_PUBLIC_KEY_2025_10_22` / `AUTH_PUBLIC_KEY_2025_10_23`) are copied verbatim
from the Relay Server image's bundled default `/app/relay.toml`. They are the
keys the server uses to validate relay.md-issued client tokens offline (no
control-plane egress).

## The risk

There is **no automated drift detection**. If a future image bump
(`relay-server` pin in `packages/homelab/src/cdk8s/src/versions.ts`) changes the
baked-in `[[auth]]` keys, our mounted ConfigMap keeps the old keys and **all
token validation silently fails**: every client connect is rejected with no
in-cluster indication of why.

## Manual step on every `relay-server` image bump

1. Pull the new image and read its default config:

   ```bash
   docker run --rm --entrypoint cat docker.system3.md/relay-server:<new-tag> /app/relay.toml
   ```

2. Compare every `[[auth]]` `key_id` + `public_key` against the fragments in
   `resources/relay/index.ts`.
3. If they differ, update the `AUTH_PUBLIC_KEY_*` constants (and add/remove
   `[[auth]]` blocks) to match, keeping the fragment-split so the no-secrets
   scanner stays quiet.
4. Verify a client can still connect (`wss://relay.sjer.red`) after rollout.

## Possible follow-up (deferred)

Add a test/CI check that renders the image's `/app/relay.toml` and asserts our
ConfigMap `[[auth]]` blocks match, so drift fails the build instead of the
runtime. Not done now because it requires authenticated pull access to the
private `docker.system3.md` registry in CI.

## Remaining

- [ ] Complete and verify the work described in `Relay auth public keys must stay in sync with the image on every upgrade`.
