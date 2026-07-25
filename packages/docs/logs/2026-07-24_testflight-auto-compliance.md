---
id: log-2026-07-24-testflight-auto-compliance
type: log
status: complete
board: false
---

# Auto-answer TestFlight export compliance (ITSAppUsesNonExemptEncryption)

## Problem

Every TestFlight build (see App Store Connect screenshots) sat at **"Missing
Compliance"**, which blocks the TestFlight Internal Testing post-action from
distributing the build to the Development tester group until the export-encryption
question is answered by hand in App Store Connect. Build #62 only reached "Ready
to Test" after the owner answered the App Encryption Documentation dialog
manually; every earlier build stayed undistributed.

## Fix

Add `ITSAppUsesNonExemptEncryption` = `false` to
`packages/tasks-for-obsidian/ios/TasksForObsidian/Info.plist`. The app uses only
standard, exempt encryption (HTTPS/TLS to the TaskNotes server), which qualifies
for the export-compliance exemption. Declaring it in `Info.plist` is Apple's
documented way to bypass the App Store Connect prompt (the dialog itself points to
this). Every future Xcode Cloud build now auto-clears compliance and distributes
to internal testers with no manual step.

## Verification

- `plutil -lint` on the edited `Info.plist`.
- Post-merge: the next push-triggered Xcode Cloud build should go straight to
  "Ready to Test" and appear on the phone without touching App Store Connect.
