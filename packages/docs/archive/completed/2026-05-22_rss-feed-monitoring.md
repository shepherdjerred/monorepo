---
id: reference-completed-2026-05-22-rss-feed-monitoring
type: reference
status: complete
board: false
---

# RSS Feed Monitoring

## Summary

Add RSS-aware monitoring for `https://sjer.red/rss.xml` using the existing homelab Prometheus blackbox-exporter path. The check should fail when the URL is unreachable, returns a bad HTTP response, times out, or stops returning a body that looks like an RSS feed.

## Plan

- Extend static-site probe generation to support additional path-specific probes.
- Add an RSS endpoint probe for `sjer.red` at `/rss.xml` with labels for `site`, `endpoint`, and `path`.
- Add a `rss_2xx` blackbox-exporter module that performs normal HTTP checks and verifies RSS body markers.
- Update static-site alerts so endpoint/path context is visible in PagerDuty.
- Add Grafana visibility for static-site and RSS probe health.

## Verification

- `cd packages/homelab/src/cdk8s && bun run typecheck`
- `cd packages/homelab/src/cdk8s && bun run test`
- `cd packages/homelab/src/cdk8s && bun run lint`

## Session Log — 2026-05-22

### Done

- Added path-specific static-site probe support in `packages/homelab/src/cdk8s/src/misc/s3-static-site.ts`.
- Added the `sjer.red` RSS probe at `https://sjer.red/rss.xml` with `module="rss_2xx"` and `site` / `endpoint` / `path` labels.
- Added shared blackbox module config in `packages/homelab/src/cdk8s/src/misc/blackbox-modules.ts` and wired it into both blackbox-exporter definitions.
- Updated static-site alerts to include endpoint/path context and added `StaticSiteRssProbeAbsent`.
- Added the `Static Site Probes` Grafana dashboard and registered it through dashboard ConfigMap provisioning.
- Added synthesis coverage for the RSS probe in `packages/homelab/src/cdk8s/src/misc/s3-static-site.test.ts`.
- Verified locally with `bun run typecheck`, `bun run test`, and `bun run lint` from `packages/homelab/src/cdk8s`.

### Remaining

<!-- temporal-agent-task
{
  "title": "Verify RSS feed monitoring post-deploy",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-05-25T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/plans/2026-05-22_rss-feed-monitoring.md"
  },
  "prompt": "Verify the RSS feed monitoring rollout from PR #864. Email a report covering: (1) Are probe_success and probe_http_status_code series present for job=\"static-site-sjer.red-rss\" in Prometheus? Include the most recent sample timestamps. (2) Are any StaticSite* alerts firing in Alertmanager — especially StaticSiteRssProbeAbsent, StaticSiteDown, or the SSL expiry alerts? (3) Is the \"Static Site Probes\" Grafana dashboard provisioned and rendering panels? Use the grafana-helper skill to query. Do not edit files or mutate live systems."
}
-->

- After ArgoCD deploys the chart, verify live Prometheus metrics for `probe_success{job="static-site-sjer.red-rss"}` and `probe_http_status_code{job="static-site-sjer.red-rss"}`.
- Confirm no new `StaticSite*` alerts are firing and that Grafana provisions the `Static Site Probes` dashboard.

### Caveats

- The local sandbox could not resolve `sjer.red`, so endpoint behavior was verified through generated manifests and Helm rendering rather than a live external fetch.
- Verification used `MISE_TRUSTED_CONFIG_PATHS` because this fresh worktree has untrusted mise configs and sandboxed mise state tracking emits warnings.
