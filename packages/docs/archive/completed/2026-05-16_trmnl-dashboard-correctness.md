---
id: reference-completed-2026-05-16-trmnl-dashboard-correctness
type: reference
status: complete
board: false
---

# TRMNL Dashboard Correctness

## Summary

TRMNL dashboard data was rendering failed collectors as zero values and undercounting Home Assistant problem entities by using the capped display list as the metric. The fix separates real counts from display rows, makes collector failures visible, corrects Bugsink service connectivity, validates tokens, and adds regression tests for the gaps.

## Implementation Notes

- TRMNL payloads now include `generated_time`, formatted server-side with `DISPLAY_TIME_ZONE` defaulting to `America/Los_Angeles`.
- Home Assistant problem collection now filters benign domains to match the monitoring policy, returns full unavailable/low-battery counts, and separately caps display rows.
- Bugsink now defaults to `http://bugsink-bugsink-service.bugsink:8000/api/canonical/0` and no longer sends unsupported `status=unresolved`.
- Homelab templates render `ERR` for unknown Bugsink/PagerDuty collectors, show critical and warning alert counts, use `generated_time`, and display compact diagnostics.
- Bugsink `ALLOWED_HOSTS` includes internal service hostnames.
- `trmnl-dashboard-credentials` in 1Password was updated with validated Bugsink and PagerDuty tokens.

## Testing

- Added client tests for Home Assistant count/display separation, Bugsink pagination/filtering, and PagerDuty error behavior.
- Added collector tests for failure surfacing and storage mount filtering.
- Added cdk8s synth tests for TRMNL Bugsink URL and Bugsink internal hostnames.
- Made cdk8s lint dependencies explicit so `bun run lint` is reproducible in this package.
