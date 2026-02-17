# Screenshot Generation Guide

This guide explains how to generate **REAL** screenshots from the actual Clauderon application for documentation.

## Prerequisites

1. **Build Clauderon**: `cargo build --release`
2. **Install dependencies**: `cd web/frontend && bun install`
3. **Install Playwright browsers**: `cd web/frontend && bunx playwright install chromium`

## Generating Screenshots

### 1. CLI Screenshots (SVG)

Generate SVG screenshots from the real clauderon binary:

```bash
# Make sure clauderon is built first
cargo build --release

# Generate CLI screenshots
./scripts/generate-cli-screenshots.sh
```

This will create:

- `screenshots/cli/clauderon-help.svg` - Main help output
- `screenshots/cli/clauderon-version.svg` - Version info
- `screenshots/cli/clauderon-list.svg` - Session list
- `screenshots/cli/clauderon-list-archived.svg` - List with archived sessions
- `screenshots/cli/clauderon-create-help.svg` - Create command help
- `screenshots/cli/clauderon-attach-help.svg` - Attach command help
- `screenshots/cli/clauderon-archive-help.svg` - Archive command help
- `screenshots/cli/clauderon-delete-help.svg` - Delete command help
- `screenshots/cli/clauderon-daemon-help.svg` - Daemon command help
- `screenshots/cli/clauderon-tui-help.svg` - TUI command help
- `screenshots/cli/clauderon-config.svg` - Configuration output
- `screenshots/cli/clauderon-reconcile-help.svg` - Reconcile command help
- `screenshots/cli/clauderon-clean-cache-help.svg` - Clean cache command help

**Note**: These use the REAL clauderon binary output, not mock data.

### 2. TUI Screenshots (PNG)

Generate PNG screenshots from the real TUI using ratatui TestBackend:

```bash
# Run TUI screenshot tests (marked as ignored)
cargo test --test screenshot_tests -- --ignored --nocapture
```

This will create:

- `screenshots/tui/session-list.png` - Session list view
- `screenshots/tui/create-dialog.png` - Create dialog
- `screenshots/tui/help-screen.png` - Help screen
- `screenshots/tui/empty-session-list.png` - Empty state
- `screenshots/tui/delete-confirmation.png` - Delete dialog
- `screenshots/tui/archive-confirmation.png` - Archive confirmation
- `screenshots/tui/health-modal.png` - Health status modal
- `screenshots/tui/session-list-filtered.png` - Filtered session list

**Note**: These render the REAL TUI components using the actual App state.

### 3. Web Screenshots (PNG)

Generate PNG screenshots from the real web application using Playwright:

**Prerequisites**:

1. **Start Clauderon daemon** (in terminal 1):

   ```bash
   cargo run -- daemon
   ```

2. **Start dev server** (in terminal 2):

   ```bash
   cd web/frontend
   export PATH="$HOME/.bun/bin:$PATH"
   bun run dev
   ```

   Wait for it to say "ready" at http://localhost:5173

3. **(Optional) Create some sessions** for better screenshots:

   ```bash
   # In terminal 3
   cargo run -- create --repo ~/some-project --prompt "Example task"
   ```

4. **Run screenshot tests** (in terminal 3):
   ```bash
   cd web/frontend
   export PATH="$HOME/.bun/bin:$PATH"
   bun run screenshots
   ```

This will create:

- `screenshots/web/login.png` - Login page (1920x1080)
- `screenshots/web/dashboard.png` - Session dashboard (1920x1080)
- `screenshots/web/create-dialog.png` - Create session dialog (1920x1080)
- `screenshots/web/session-detail.png` - Session detail view (1920x1080)
- `screenshots/web/session-filters.png` - Session filters (1920x1080)
- `screenshots/web/empty-state.png` - Empty state (1920x1080)

**Note**: These screenshot the REAL React application, not mock HTML.

### 4. Copy to Docs

After generating all screenshots:

```bash
./scripts/update-docs-screenshots.sh
```

This copies screenshots from `screenshots/` to `docs/src/assets/screenshots/`.

### 5. Generate All at Once

**Master script** (requires manual server setup first):

```bash
# Terminal 1: Start daemon
cargo run -- daemon

# Terminal 2: Start web dev server
cd web/frontend && bun run dev

# Terminal 3: Generate all screenshots
./scripts/generate-all-screenshots.sh
```

## Verification

Check generated screenshots:

```bash
ls -lh screenshots/cli/
ls -lh screenshots/tui/
ls -lh screenshots/web/
ls -lh docs/src/assets/screenshots/
```

Build docs to verify they render correctly:

```bash
cd docs
bun run build
bun run preview
```

## Important Notes

- ✅ **All screenshots use REAL application data**
- ✅ CLI screenshots: Real `clauderon` binary output
- ✅ TUI screenshots: Real ratatui components via TestBackend
- ✅ Web screenshots: Real React app via Playwright
- ❌ **No mock data or fake HTML pages**

## Troubleshooting

**"clauderon binary not found"**:

- Run `cargo build --release` first

**"Could not find create button"**:

- Make sure the dev server is actually running at http://localhost:5173
- Check that you're logged in (if WebAuthn is enabled)

**TUI tests fail to compile**:

- Make sure dev dependencies are installed: `cargo fetch`
- Check that `image`, `ab_glyph`, and `imageproc` crates are in Cargo.toml

**Web screenshots timeout**:

- Ensure daemon is running: `cargo run -- daemon`
- Ensure dev server is running: `cd web/frontend && bun run dev`
- Check http://localhost:5173 loads in your browser
