---
id: xcode-cloud-webhook-registration-verification
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/archive/completed/2026-07-11_xcode-cloud-alerts.md
source_marker: false
---

# Register and verify the Xcode Cloud alert webhook

PR #1455 shipped the receiver, secret reference, tunnel, and alert routing, but
App Store Connect registration and real delivery have not been recorded.

## Remaining

- [ ] In App Store Connect, confirm or create the webhook using the protected
      token from 1Password without recording it in git.
- [ ] Re-send a failed build delivery report, or trigger a controlled failed
      build, and confirm `XcodeCloudBuildFailed` reaches Alertmanager and
      PagerDuty.
- [ ] Confirm a later successful build resolves the same alert labels and
      compare the real payload with the committed fixtures.

## Comment Log

- 2026-07-27 — Split from the completed implementation plan because App Store
  Connect registration and real delivery require operator access.
