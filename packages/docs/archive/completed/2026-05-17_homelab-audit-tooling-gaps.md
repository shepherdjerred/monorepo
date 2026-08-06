---
id: reference-completed-2026-05-17-homelab-audit-tooling-gaps
type: reference
status: complete
board: false
---

# Homelab Audit Tooling Gap Remediation

## Summary

Fix only the audit tooling gaps surfaced in the May 13-17 homelab audit emails. The implementation will improve the audit worker image, preflight checks, Bugsink/Grafana/Buildkite/Temporal visibility, S3 audit archiving, and read-only RBAC coverage without remediating the service findings themselves.

## Implementation Plan

- Add missing `bk` and `temporal` CLIs to the Temporal worker image with pinned versions and build-time smoke checks.
- Add a preflight activity before the audit agent so missing local tooling and required secrets fail clearly, while remote API/tool failures are injected into the audit prompt as warnings.
- Archive generated audit Markdown and rendered HTML to S3 before sending the email, then archive message metadata after Postal accepts the email.
- Update the audit prompt and runbook so Prometheus firing alerts are primary, Grafana-managed rules are explicitly secondary, Bugsink project filters match toolkit behavior, and Temporal uses direct CLI access through `TEMPORAL_ADDRESS`.
- Keep audit RBAC read-only while adding only the Tailscale CRDs the runbook reads.
