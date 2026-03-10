# HN Enhancer

A Chrome extension that enhances the Hacker News browsing experience.

## Features

- **AI Negativity Filter** — Detects and dims/hides/labels dismissive anti-AI comments using regex patterns and optional on-device AI
- **Hide Users** — Click to hide comments from specific users
- **New Account Filter** — Hide comments from accounts younger than a configurable age
- **Reply Notifications** — Get notified when someone replies to your comments

## Installation

1. `bun install && bun run build`
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" → select the `dist/` folder

## Enabling Chrome AI (Gemini Nano)

The sentiment filter works with regex patterns out of the box. For better accuracy on ambiguous comments, you can enable Chrome's built-in AI:

1. **Chrome 128+** required
2. Go to `chrome://flags/#optimization-guide-on-device-model` → set to **Enabled BypassPerfRequirement**
3. Go to `chrome://flags/#prompt-api-for-gemini-nano` → set to **Enabled**
4. Restart Chrome
5. Go to `chrome://components/` → find "Optimization Guide On Device Model" → click **Check for update**
6. Wait for the model to download (~1.7 GB)
7. In the extension popup, check **"Use Chrome AI for ambiguous comments"**

When enabled, a small spinner appears next to comments being analyzed by the AI. Results are cached so subsequent page loads are instant.

## Development

```bash
bun install
bun run dev      # Start dev server with HMR
bun run build    # Production build
bun test         # Run tests
bun run typecheck
bunx eslint .
```
