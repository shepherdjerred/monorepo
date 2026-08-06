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
