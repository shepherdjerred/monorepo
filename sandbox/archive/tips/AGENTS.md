# QuickTip — macOS Menu Bar App

SwiftUI menu bar app that surfaces daily tips for Mac apps and tools.

## Build & Run

```bash
cd packages/tips/QuickTipApp
swift build              # Build
swift test               # Run tests
swift run                # Run app (appears in menu bar)
swift build -c release   # Release build
```

## Install

```bash
cd packages/tips
make install             # SPM build → /Applications
make install-xcode       # Xcode build → /Applications
```

## Structure

- `content/` — Markdown tip files with YAML frontmatter (one per app)
- `QuickTipApp/` — Swift Package (SPM, product name: QuickTipApp)
  - `Sources/` — App code (SwiftUI views, models, services)
  - `Tests/` — Swift Testing tests
- `project.yml` — XcodeGen config (generates `QuickTip.xcodeproj`)
- `QuickTip.xcodeproj` is gitignored; regenerate with `make xcode`

## Adding Tips

Create a markdown file in `content/` with this format:

```markdown
---
app: App Name
icon: sf.symbol.name
color: "#HexColor"
---

## Section Name

- Tip text here
- `⌘K` — Shortcut description
```

## Quality

- Swift 6 language mode (strict concurrency)
- Warnings treated as errors
- SwiftLint with strict config
- SwiftFormat for consistent formatting
