# pinchtab / birmel / mcp-gateway health check

## Status

Partially Complete — pinchtab fixed (cluster + PR pending); mcp-gateway blocked on 1Password fields

## Context

Asked to look at the `pinchtab`, `birmel`, and `mcp-gateway` services on the homelab
Kubernetes cluster (`torvalds`). Found two of the three crashing.

## Findings

| Service     | State                      | Root cause                                                                                                                  |
| ----------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| birmel      | Running 1/1                | Healthy, no action                                                                                                          |
| pinchtab    | CrashLoopBackOff           | `config.json` `server.port` emitted as a JSON number; pinchtab 0.13.2 requires a string                                     |
| mcp-gateway | CreateContainerConfigError | `mcp-gateway-credentials` 1Password item has empty `FASTMAIL_TOKEN` / `GMAIL_TOKEN` fields → keys absent from synced Secret |

### pinchtab (fixed in code + hotfixed on cluster)

Two distinct regressions from the 0.13.2 deployment, found in sequence:

**(1) port type.** Container log:

```
failed to parse config error="json: cannot unmarshal number into Go struct
field ServerConfig.server.port of type string"
```

The server never binds 9867, so the startup probe gets connection refused and the
pod crashloops. Commit `a831c840f` ("fix(homelab): emit pinchtab config port as
integer") changed `String(PINCHTAB_PORT)` → `PINCHTAB_PORT` based on a
**speculative** Greptile P2 comment. The live runtime proves the opposite — 0.13.2
types `server.port` as a string. Reverted to `String(PINCHTAB_PORT)`.

**(2) authenticated health endpoint.** After the port fix the server bound but the
probe returned `HTTP 401`. pinchtab 0.13.2 ships a "guard" that requires the bearer
token on **every** route except `/` (verified: `/health`, `/healthz`, `/livez`,
`/readyz`, `/ping`, `/status` all 401 without the token; `/` returns 200). The
unauthenticated httpGet `/health` probe can never pass. Switched all three probes
to an **exec probe** that reads `PINCHTAB_TOKEN` from the container env and calls
`/health` with `wget --header="Authorization: Bearer $PINCHTAB_TOKEN"` — keeps a
real health check without putting the secret in the manifest.

Both fixes are in `packages/homelab/src/cdk8s/src/resources/pinchtab/index.ts`.

**Cluster hotfix (applied live, holds until the PR chart deploys):**
The ArgoCD app `pinchtab` has `automated` sync **without selfHeal**, and deploys a
prebuilt Helm chart from chartmuseum (not git). So manual drift holds until the
next chart version publishes. Applied:

```bash
kubectl patch configmap pinchtab-config -n pinchtab --type merge ...  # port -> "9867"
kubectl patch deploy pinchtab -n pinchtab --type json ...             # 3 probes -> exec
kubectl rollout restart deploy/pinchtab -n pinchtab
```

Pod is now `1/1 Running`. App shows `OutOfSync / Healthy` (expected drift); the
merged PR rebuilds the chart and restores Sync.

### mcp-gateway (needs operator action — blocked on secrets)

Pod event:

```
Error: couldn't find key FASTMAIL_TOKEN in Secret mcp-gateway/mcp-gateway-credentials
```

The deployment reads `FASTMAIL_TOKEN` (Fastmail JMAP MCP) and `GMAIL_TOKEN`
(Gmail reader MCP) from item `iixelnobjabehkgxhl3ekacdy4`. Both fields **exist**
in the 1Password item but are **empty** (`hasValue: false`), so the operator omits
them from the synced Secret. The "Postal Fastmail" item only holds an SMTP
forwarding password (`root@sjer.red`) — not a JMAP API token — so it is not a valid
substitute. No Gmail item exists in the vault.

Resolution (requires real credentials the agent does not have):

```bash
op item edit iixelnobjabehkgxhl3ekacdy4 \
  'FASTMAIL_TOKEN[password]=<fastmail-api-token-with-mail-read-scope>' \
  'GMAIL_TOKEN[password]=<gmail-16-char-app-password>'
```

After the operator re-syncs, `kubectl rollout restart deploy/mcp-gateway -n mcp-gateway`.

## Session Log — 2026-06-06

### Done

- Diagnosed all three services against live cluster state (`torvalds`).
- Fixed pinchtab port regression: `packages/homelab/src/cdk8s/src/resources/pinchtab/index.ts`
  reverted to `String(PINCHTAB_PORT)` with explanatory comment.
- Verified `bun run typecheck` clean for cdk8s after `scripts/setup.ts` (reverted
  incidental `packages/sjer.red/bun.lock` churn).

### Remaining

- Deploy the pinchtab fix via CI/ArgoCD (never `kubectl apply` directly).
- Populate `FASTMAIL_TOKEN` and `GMAIL_TOKEN` in 1Password item
  `iixelnobjabehkgxhl3ekacdy4`, then roll the mcp-gateway deployment.

### Caveats

- pinchtab fix is a revert of `a831c840f`; the Greptile P2 that prompted that
  commit was wrong — do not re-apply it.
- mcp-gateway will keep CreateContainerConfigError until the two 1Password fields
  have values; nothing further is code-fixable.
