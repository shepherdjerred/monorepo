# Tips — macOS Menu Bar App

SwiftUI menu bar app that surfaces daily tips for Mac apps and tools.

## Build & Run

```bash
cd packages/tips/TipsApp
swift build              # Build
swift test               # Run tests
swift run                # Run app (appears in menu bar)
swift build -c release   # Release build
```

## Structure

- `content/` — Markdown tip files with YAML frontmatter (one per app)
- `TipsApp/` — Swift Package (SPM)
  - `Sources/` — App code (SwiftUI views, models, services)
  - `Tests/` — Swift Testing tests

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
