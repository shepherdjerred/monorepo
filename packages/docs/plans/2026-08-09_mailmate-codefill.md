---
id: mailmate-codefill
type: plan
status: in-progress
board: false
---

# MailMate CodeFill

Build a direct-distribution macOS product that connects MailMate's bundle
commands to native macOS one-time-code AutoFill.

## Components

- A MailMate `.mmBundle` runs from a mailbox rule or the Command menu. It asks
  MailMate for canonical decoded message text and metadata, then invokes the
  signed helper contained in the app.
- A small setup app documents provider enablement and MailMate rule setup. It
  has no watcher, menu-bar item, MailMate database access, or Accessibility
  permission requirement.
- An `AuthenticationServices` credential-provider extension advertises
  `ProvidesOneTimeCodes`, handles one-time-code requests, and reads only
  unexpired records from the App Group store.

## Privacy and expiry

The shared store contains only the detected code, optional service/domain,
sender label, message ID, and detection/expiry timestamps. It never stores the
decoded email body. Writes use a temporary file followed by an atomic replace;
records expire after three minutes and are removed after successful use or
expiry.

## Approved production direction

- Move credential-identity synchronization out of the setup view. After a
  matching message is ingested, the helper launches the containing app without
  activation. The app acts as an event-driven broker, reconciles the native
  identity store, remains alive only until active codes expire, and exits
  without a Dock or menu-bar workflow.
- Derive normalized AutoFill service identifiers from the sender domain and
  HTTP(S) links in the decoded message. Persist only domains or origins, never
  URL paths, queries, or message bodies.
- Keep explicit localhost service identifiers and a deterministic test action
  so the demo page validates native suggestions independently of an unrelated
  email sender domain.
- Keep identity-store access in the supported containing-app and credential-
  provider targets. The ingestion helper writes the App Group record and wakes
  the broker but does not receive the AutoFill provider entitlement.

## Verification

- Run parser and shared-store tests with canonical MailMate fixtures. The local
  suite now covers numeric, spaced, dashed, multilingual, false-positive, expiry,
  consume, ordering, and concurrent same-process writes.
- Generate and build the Xcode project with the development team provisioned
  locally. The app, provider, and helper now carry the same team-prefixed App
  Group entitlement, and the nested helper is signed inside the containing app.
- Verify the final signed/notarized build and native AutoFill behavior on macOS
  Tahoe with MailMate, Safari, Chrome, and a native text field.
- Verify structured Unified Logging across the app, bundle/helper, store,
  provider, demo, and release surfaces, including privacy-safe diagnostics.

## Remaining

- [x] Implement the invisible event-driven broker, expiry timer, and identity-
      store reconciliation independently of the setup window lifecycle.
- [ ] Replace the single sender-derived service with normalized sender-domain
      and message-link identifiers, including deterministic localhost fixtures.
- [ ] Add an in-app demo-code action and privacy-safe pipeline diagnostics for
      ingestion, broker launch, identity sync, provider request, consumption, and
      expiry.
- [ ] Run the release script with a Developer ID Application certificate and a
      configured `notarytool` Keychain profile; local development signing is not a
      substitute for notarization.
- [ ] Add the MailMate Inbox rule on the target installation and run final live
      AutoFill acceptance in MailMate, Safari, Chrome, and a native macOS text field.
- [ ] Inspect a production candidate's Unified Log stream during one complete
      ingestion-to-AutoFill flow and confirm no code or message content appears.
