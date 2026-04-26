# Plan: bedrock-waker — UDP proxy to wake sleeping Minecraft Bedrock servers

## Status

Not Started. No `packages/bedrock-waker/` package or cdk8s bedrock-waker resources exist yet.

## Context

mc-router handles Java Edition (TCP) hostname-based routing with auto-scale up/down of StatefulSets. When a Java player connects, mc-router wakes the sleeping server. But Bedrock players connecting via Geyser use UDP, which mc-router doesn't handle. mc-router has no REST API for external wake triggers. When the minecraft-shuxin StatefulSet is scaled to 0, Bedrock players see a timeout with no way to wake the server.

**Solution:** A lightweight UDP proxy (`bedrock-waker`) that sits in front of Geyser's UDP port. It intercepts Bedrock RAKNET packets, wakes the StatefulSet via the K8s API when needed, shows a "waking up" MOTD while the server starts, and transparently proxies all UDP traffic once the server is ready.

## Research Summary

### Why not existing tools?

| Solution                 | Java wake | Bedrock wake  | K8s support                        |
| ------------------------ | --------- | ------------- | ---------------------------------- |
| mc-router                | Yes       | No (TCP only) | Yes                                |
| Gate + LazyGate          | Yes       | Maybe         | No (Docker/Nomad/PufferPanel only) |
| Velocity + custom plugin | Yes       | Possible      | DIY                                |

- **mc-router** only handles TCP. Its auto-scale-up is deeply coupled to the Java Edition handshake protocol (reads `serverAddress` from the TCP handshake packet). No REST API for external wake triggers.
- **Gate proxy** has built-in Bedrock support via Geyser, but its Lite mode (hostname routing) doesn't support Bedrock. **LazyGate** (Gate plugin for sleep/wake) only supports Docker, Nomad, and PufferPanel — no K8s.
- **Bedrock RAKNET packets don't contain a hostname**, so hostname-based multiplexing isn't possible. Each server needs a dedicated port (which minecraft-shuxin already has: NodePort 30003).

### mc-router auto-scale internals

mc-router scales StatefulSets via K8s API:

- `PATCH /apis/apps/v1/namespaces/{ns}/statefulsets/{name}` with `{"spec":{"replicas":1}}`
- Only triggers on **login** handshakes (not status/ping) to avoid waking on server list refreshes
- Uses `statefulSet.spec.serviceName` to link Services to StatefulSets
- Required annotations on the Service: `mc-router.itzg.me/externalServerName`, `mc-router.itzg.me/autoScaleUp`

## Architecture

```
Java client (TCP)    → mc-router (NodePort 30000)      → wakes StatefulSet → proxies to pod
Bedrock client (UDP) → bedrock-waker (NodePort 30003)  → wakes StatefulSet → proxies UDP to Geyser on pod
```

bedrock-waker is an always-on Deployment (tiny footprint: ~64Mi RAM, 50m CPU). mc-router continues to handle idle scale-down — bedrock-waker does not need its own scale-down logic.

## New Package: `packages/bedrock-waker/`

```
packages/bedrock-waker/
├── BUILD.bazel
├── package.json
├── tsconfig.json
├── eslint.config.ts
└── src/
    ├── index.ts      # Entry point, signal handling
    ├── config.ts     # Env var parsing with Zod
    ├── raknet.ts     # Minimal RAKNET packet parsing (UNCONNECTED_PING/PONG only)
    ├── k8s.ts        # In-cluster K8s API: scale StatefulSet, poll readiness
    ├── proxy.ts      # UDP proxy loop, session management (Map<clientKey, upstreamSocket>)
    └── motd.ts       # Synthetic UNCONNECTED_PONG builder with Bedrock MOTD format
```

### Key implementation details

- **UDP:** `Bun.udpSocket()` for listening and per-client upstream sockets
- **K8s API:** Plain `fetch()` with in-cluster ServiceAccount token (`/var/run/secrets/kubernetes.io/serviceaccount/token`). Only needs PATCH (scale up) and GET (poll readiness). Set `NODE_EXTRA_CA_CERTS` to the cluster CA cert.
- **RAKNET parsing:** Only parse packet ID (first byte) and UNCONNECTED_PING (0x01) fields: timestamp (8 bytes), MAGIC (16 bytes: `00ffff00fefefefefdfdfdfd12345678`), client GUID (8 bytes). Construct UNCONNECTED_PONG (0x1C) with Bedrock MOTD string format: `MCPE;ServerName;protocol;version;online;max;guid;submotd;gamemode;...`
- **Session management:** `Map<"ip:port", { upstreamSocket, lastSeen }>`. Each Bedrock client gets its own ephemeral UDP socket to the backend. Sessions expire after 30s of inactivity.
- **Wake guard:** Boolean flag prevents concurrent wake attempts. Bun's single-threaded event loop ensures no races.
- **Config:** Zod schema parsing env vars: `LISTEN_PORT`, `BACKEND_HOST`, `BACKEND_PORT`, `STATEFULSET_NAME`, `STATEFULSET_NAMESPACE`, `SESSION_TIMEOUT_MS`, `WAKE_TIMEOUT_MS`, `POLL_INTERVAL_MS`, `SERVER_MOTD`

### Bazel BUILD

Follow `packages/birmel/BUILD.bazel` pattern exactly:

- `js_library` with `glob(["src/**/*.ts"])` + deps on `zod` and `@types/bun`
- `bun_service_image` targeting `ghcr.io/shepherdjerred/bedrock-waker`
- `eslint_test`, `typecheck_test`, `bun_test`

## Infrastructure Changes

### 1. Remove Bedrock NodePort from minecraft-shuxin

**File:** `packages/homelab/src/cdk8s/src/resources/argo-applications/minecraft-shuxin.ts`

Remove the bedrock `extraPorts` entry that currently exposes UDP 19132 as NodePort 30003 directly on the StatefulSet. Geyser still listens on 19132 inside the pod — bedrock-waker will reach it via the ClusterIP service once the pod is running.

### 2. Add image version to versions.ts

**File:** `packages/homelab/src/cdk8s/src/versions.ts`

```typescript
// Custom bedrock-waker image - UDP proxy for Bedrock server wake
// not managed by renovate
"shepherdjerred/bedrock-waker": "<placeholder>",
```

### 3. Create CDK8s resource

**File:** `packages/homelab/src/cdk8s/src/resources/bedrock-waker/index.ts`

Following the sentinel pattern (`cdk8s-plus-31` constructs):

- `ServiceAccount` with `automountToken: true`
- `Role` (namespace-scoped to `minecraft-shuxin`) with verbs `["get", "patch"]` on `statefulsets` resource — use `KubeRole`/`KubeRoleBinding` from generated K8s imports (cross-namespace binding)
- `Deployment` (1 replica) with the bedrock-waker image, env vars, UDP port 19132
- `Service` (type: NodePort) exposing UDP 19132 as NodePort 30003

### 4. Create CDK8s chart

**File:** `packages/homelab/src/cdk8s/src/cdk8s-charts/bedrock-waker.ts`

### 5. Create Helm chart stub

**File:** `packages/homelab/src/cdk8s/helm/bedrock-waker/Chart.yaml`

### 6. Create ArgoCD Application

**File:** `packages/homelab/src/cdk8s/src/resources/argo-applications/bedrock-waker.ts`

### 7. Wire into existing files

- `packages/homelab/src/cdk8s/src/cdk8s-charts/apps.ts` — import + call `createBedrockWakerApp(chart)`
- `packages/homelab/src/cdk8s/src/setup-charts.ts` — import + call `createBedrockWakerChart(app)`
- `scripts/ci/src/ci/homelab_release.py` — add `"bedrock-waker"` to `HELM_CHARTS` list

## Edge Cases

- **Multiple clients pinging during wake:** Single-threaded Bun event loop + boolean `waking` flag means only one wake attempt runs. All clients get MOTD responses.
- **StatefulSet already at 1 replica:** K8s PATCH with `replicas: 1` is idempotent — no-op.
- **Slow server startup:** Default `WAKE_TIMEOUT_MS: 120000` gives 2 minutes for Paper JVM + plugin loading.
- **K8s token rotation:** Re-read token from disk on each API call (projected tokens rotate automatically).
- **mc-router scales down mid-game:** Existing sessions timeout naturally (30s). Players disconnect at Geyser level first.

## Verification

1. `bun run typecheck` from root
2. `cd packages/bedrock-waker && bunx eslint .`
3. `bun test` — RAKNET parsing, MOTD building, config validation
4. `cd packages/homelab && bunx cdk8s synth` — verify Helm chart output
5. `bazel build //packages/bedrock-waker:image`
6. Manual test: send synthetic UNCONNECTED_PING, verify PONG response
