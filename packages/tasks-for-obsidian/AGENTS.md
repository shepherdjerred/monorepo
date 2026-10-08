# Facet iOS constraints

The release app is SwiftUI over the shared Rust runtime. Native sources live in
`ios/Facet`; `ios/project.yml` owns the Xcode project. Preserve the existing app
identity, App Group, widget identifiers, intents, and Xcode Cloud product.

- The platform host owns Keychain, provider grants, transport and lifecycle.
  Rust owns task semantics, configuration, recurrence, receipts and Sync policy.
- All synchronous FFI runs away from the main actor. Validate the shared JSON
  schema at native seams; unsupported versions and fields fail explicitly.
- Local providers must prove confinement, materialization and safe exchange.
  A folder grant alone does not establish write capability.
- Direct Sync replicas are app-private. Download configuration before requesting
  consent for TaskNotes defaults. Never execute downloaded Obsidian plugins.
- App Group data contains minimal durable snapshots/actions, never credentials
  or the runtime database. Preserve complete action envelopes on retries.
- The release app has no server URL/token configuration or JavaScript bundle.
  Historical TypeScript tests do not prove native standalone acceptance.

Build the matching Rust XCFramework before native compilation. Native acceptance
exercises real Markdown, persistence and relaunch, with screenshots for UI.
Xcode Cloud owns signed Archive/TestFlight; simulator evidence is separate.
Store publication, enrollment, signing and export compliance require the owner's
explicit release authorization.
