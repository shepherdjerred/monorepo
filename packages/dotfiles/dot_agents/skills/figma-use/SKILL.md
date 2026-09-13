---
name: figma-use
description: |
  This skill should be used when the user asks to "create a Figma design", "design in Figma",
  "make a Figma mockup", "create an app icon", "design UI", "render JSX to Figma",
  "export from Figma", "modify Figma design", or mentions Figma design tasks.
  Controls Figma desktop via CLI with imperative commands and declarative JSX rendering.
---

# figma-use

CLI tool to control Figma desktop app. Two modes: imperative commands and declarative JSX rendering. Installed at `~/.bun/bin/figma-use`.

## Connection

Figma must be running with remote debugging enabled.

```bash
# Check connection
figma-use me  # More reliable than `figma-use status` (which has a font-loading bug)

# If not connected, quit and relaunch Figma:
osascript -e 'tell application "Figma" to quit'
sleep 2
open -a Figma --args --remote-debugging-port=9222
```

Figma 126+ blocks the debug port. Run `figma-use patch` once to fix (click "Always Allow" on the keychain prompt). Re-run after Figma updates.

Alternative: `figma-use daemon start --pipe` launches Figma with a debug pipe (no patching needed).

## Quick Reference

### Imperative Commands

```bash
figma-use create frame --width 400 --height 300 --fill "#FFF" --layout VERTICAL --gap 16
figma-use create text --text "Hello" --font-size 24 --fill "#000"
figma-use create rect --width 100 --height 50 --fill "#F00" --radius 8
figma-use create icon mdi:home --size 32 --color "#3B82F6"
figma-use set fill <id> "#FF0000"
figma-use node move <id> --x 100 --y 200
figma-use export node <id> --output design.png
figma-use export screenshot --output viewport.png
```

### Declarative JSX

Props go directly on elements, NOT in `style={{}}`:

```bash
echo '<Frame p={24} gap={16} flex="col" bg="#FFF" rounded={12}>
  <Text size={24} weight="bold" color="#000">Title</Text>
  <Text size={14} color="#666">Description</Text>
</Frame>' | figma-use render --stdin --x 100 --y 200
```

**Elements:** `Frame`, `Rectangle`, `Ellipse`, `Text`, `Line`, `Star`, `Polygon`, `Vector`, `Group`, `Icon`, `Image`, `Instance`

### Icons (150k+ from Iconify)

```bash
figma-use create icon lucide:star --size 48 --color "#F59E0B"
```

In JSX: `<Icon name="mdi:home" size={24} color="#3B82F6" />`

## Key Rules

- **Always use `--x` and `--y`** to position renders. Never stack at (0, 0).
- **Always verify visually** after creating: `figma-use export node <id> --output /tmp/check.png`
- **Zoom after creating**: `figma-use viewport zoom-to-fit <id>`
- **After initial render, use diffs or direct commands** — do not re-render full JSX trees.
- **Row layouts need explicit width**: `<Frame w={300} flex="row" gap={8}>`
- **Prefer human-readable output** over `--json` to save tokens.

## macOS App Icon Workflow

To create a macOS app icon in Figma:

1. Create a 1024x1024 frame with squircle corners (Apple uses `cornerSmoothing={0.6}`):

```bash
echo '<Frame w={1024} h={1024} bg="#3B82F6" rounded={220} cornerSmoothing={0.6}>
  <Frame w={1024} h={1024} flex="col" justify="center" items="center">
    <Icon name="lucide:terminal" size={512} color="#FFFFFF" />
  </Frame>
</Frame>' | figma-use render --stdin --x 0 --y 0
```

2. Export at required sizes and package with macOS tools:

```bash
figma-use export node <id> --output icon_1024.png --scale 1
# Then use sips + iconutil to create .icns
```

## MCP Server

figma-use includes a built-in MCP server exposing 90+ tools. Already configured in Claude Code at `http://localhost:38451/mcp`.

Start before use: `figma-use mcp serve`

## Additional Resources

For the complete command reference, style shorthands, components, variants, diffs, queries, analyze, and lint commands, consult:

- **`references/commands.md`** — Full figma-use command reference and style shorthand tables
