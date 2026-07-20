---
id: log-2026-07-12-pr-1505-blackbox-probe-greptile-fixes
type: log
status: complete
board: false
---

# PR #1505 — blackbox probe rollout: greptile P1/P2 fixes

## Findings addressed

### P1 — Public TCP probe stops at edge (`service-probes-chart.ts` / temporal webhooks)

The three Temporal webhook public probes (gh-webhook `pr-bot`, agent-task
`temporal-agent-tasks`, xcode-cloud `xcode-cloud-webhook`) used
`publicProbeModule: "tcp_connect"` → target `fqdn:443`. That only proves
Cloudflare's edge accepts a TCP connection; the probe stays green even when
the tunnel or origin is down.

Each webhook's Hono server already exposes `GET /healthz -> 200` (see
`packages/temporal/src/event-bridge/{github-webhook,agent-task-api,xcode-cloud-webhook}.ts`).
Fix: switch each public probe to `http_2xx` against `/healthz`, so the probe
does a real HTTP GET through Cloudflare to the origin's health handler —
verifying the origin end-to-end. `http_2xx` (not `https_2xx_insecure`) is
correct because the public Cloudflare hostname gets a validly-issued edge
cert (matches the module-comment convention in `blackbox-modules.ts`).

Mechanism: added `publicProbePath?: string` to `createCloudflareTunnelBinding`,
threaded through `registerPublicProbe` → `PublicProbeDescriptor.path` (defaults
to `/`) → `service-probes-chart.ts` builds `https://${fqdn}${path}`. Existing
public probes are unchanged (still `https://<fqdn>/`; verified no `//` in
synth output).

In-cluster **backend** probes for these three stay `tcp_connect` — they hit
the origin Service directly (not the edge), so they're out of scope for this
finding, and a GET would 404/405 against the POST-only receiver.

### P2 — Prometheus namespace opens all ports (`birmel.ts` + siblings)

The blackbox-exporter in-cluster health-probe ingress rule allowed the entire
`prometheus` namespace to reach the selected pods on ALL ports. Greptile's note
("the same rule shape was added to the other restricted service namespaces")
was correct — the unscoped shape appeared in 9 charts. Scoped each to the
single service port blackbox actually probes:

| chart               | port                   |
| ------------------- | ---------------------- |
| birmel              | 4112                   |
| freshrss            | 80                     |
| postal (postal-web) | 5000                   |
| plausible           | 8000                   |
| redlib              | 8080                   |
| pinchtab            | 9867 (`PINCHTAB_PORT`) |
| tasknotes           | 3000                   |
| mcp-gateway         | 9090                   |
| syncthing           | 8384                   |

`relay` (8080), `bugsink` (8000), `trmnl-dashboard` (3000), and `temporal`
(7233 + 8080) were already scoped — left as-is.

## Files changed (14)

- `misc/probe-registry.ts` (+`path` on public descriptor; +test)
- `misc/probe-registry.test.ts` (path default/override coverage)
- `misc/cloudflare-tunnel.ts` (+`publicProbePath` prop)
- `resources/monitoring/service-probes-chart.ts` (use `probe.path`)
- `resources/temporal/http-services.ts` (3 webhooks → `http_2xx` + `/healthz`)
- `cdk8s-charts/{birmel,freshrss,postal,plausible,redlib,pinchtab,tasknotes,mcp-gateway,syncthing}.ts` (scope prometheus ingress port)

## Verification

- `bun run typecheck` (src/cdk8s): clean.
- `bun test` probe-registry + http-probe + blackbox-modules: 20 pass / 0 fail.
- `bun test` birmel-network-policy: 1 pass.
- `bun run build` (full synth): success; spot-checked generated YAML —
  birmel prometheus rule scoped to 4112; 3 webhook public probes →
  `https://<fqdn>/healthz` module `http_2xx`; backend probes still
  `tcp_connect`; no double-slash in default-path probe URLs.
- eslint on all 14 files: clean.
- lefthook pre-commit (staged-lint, tunnel-dns-coverage, onepassword-items,
  homelab-helm-lint, quality-ratchet, homelab-typecheck): all passed.

Homelab does not commit generated cdk8s YAML (`dist/` untracked), so the PR
diff is `.ts` source only.

## Session Log — 2026-07-12

### Done

- Fixed both greptile findings on PR #1505; commit `12839c9f7` pushed to
  `feature/blackbox-probe-rollout` (fast-forward, non-force).
- Resolved both greptile review threads (P1 `PRRT_kwDOHf4r4c6QOmel`,
  P2 `PRRT_kwDOHf4r4c6QOmfE`).
- P2 fix extended to all 9 unscoped charts (not just birmel) since the same
  security hole was present in each; verified no unscoped prometheus rule
  remains.

### Remaining

- CI (Buildkite `buildkite/monorepo/pr`) was PENDING and Greptile re-review
  IN_PROGRESS at hand-off — orchestrator monitors to green. Nothing failing.

### Caveats

- Chose `http_2xx` (TLS-validating) over `https_2xx_insecure` for the public
  webhook probes: the Cloudflare edge cert is validly issued, per the existing
  `blackbox-modules.ts` convention. If any webhook FQDN ever isn't
  Cloudflare-fronted with a valid cert, revisit.
- Backend probes for the 3 webhooks intentionally remain `tcp_connect`; only
  the public (edge) probe was the finding.
