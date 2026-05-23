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

## Install

```bash
cd packages/glance
make install             # SPM build → /Applications (no widget)
make install-xcode       # Xcode build → /Applications (with widget)
```

## Quality

```bash
cd packages/glance
make lint                # SwiftLint --strict (app + widget)
make format              # SwiftFormat (app + widget)
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
- `GlanceWidget/` — WidgetKit extension (Notification Center widget)
  - `Sources/` — Widget entry point, timeline provider, views
  - Shows Claude Code and Codex usage gauges
- `project.yml` — XcodeGen config (generates `Glance.xcodeproj`)
- `Glance.xcodeproj` is gitignored; regenerate with `make xcode`

## Architecture

- `ServiceProvider` protocol: each service implements `fetchStatus() async -> ServiceSnapshot`
- `AppState` (@Observable): polls all providers concurrently, aggregates health
- `PollingScheduler` (actor): timer-based refresh
- `SecretProvider`: fetches API tokens from 1Password CLI (`op read`)
- `WidgetDataProvider`: writes CC/Codex usage to shared UserDefaults for widget
- All models are `Sendable` (Swift 6 strict concurrency)

### Widget Data Flow

The main app writes usage data to `UserDefaults(suiteName: "group.glance.widget")`
after each poll cycle. The widget extension reads from the same suite. Both targets
share the `group.glance.widget` App Group entitlement. Both targets require App
Sandbox (`com.apple.security.app-sandbox: true`) for widget discovery.

## Code Quality Standards

- Swift 6 language mode with ALL upcoming features enabled
- Warnings treated as errors (`-warnings-as-errors`)
- SwiftLint with strict config
- SwiftFormat for consistent formatting
- Periphery for dead code detection
- Zero suppressions policy
