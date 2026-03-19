# Glance — macOS Homelab Dashboard Menu Bar App

Native SwiftUI menu bar app that monitors homelab infrastructure services.

## Build & Run

```bash
cd packages/glance/GlanceApp
swift build              # Build (warnings are errors)
swift test               # Run tests
swift run                # Run app (appears in menu bar)
swift build -c release   # Release build
```

## Quality

```bash
cd packages/glance
make lint                # SwiftLint --strict
make format              # SwiftFormat
make dead-code           # Periphery dead code detection
```

## Structure

- `GlanceApp/` — Swift Package (SPM)
  - `Sources/` — App code
    - `Models/` — ServiceStatus, ServiceSnapshot, ServiceDetail
    - `Services/` — ServiceProvider protocol, SecretProvider, PollingScheduler
    - `Services/Providers/` — One provider per monitored service
    - `Views/` — SwiftUI views (MenuBarPopover, DashboardWindow, detail views)
  - `Tests/` — Swift Testing tests

## Architecture

- `ServiceProvider` protocol: each service implements `fetchStatus() async -> ServiceSnapshot`
- `AppState` (@Observable): polls all providers concurrently, aggregates health
- `PollingScheduler` (actor): timer-based refresh
- `SecretProvider`: fetches API tokens from 1Password CLI (`op read`)
- All models are `Sendable` (Swift 6 strict concurrency)

## Code Quality Standards

- Swift 6 language mode with ALL upcoming features enabled
- Warnings treated as errors (`-warnings-as-errors`)
- SwiftLint with strict config
- SwiftFormat for consistent formatting
- Periphery for dead code detection
- Zero suppressions policy
