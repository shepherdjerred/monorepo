---
name: lightpanda-browser
description: |
  Lightpanda headless browser CLI for fast web content extraction, searching, and fetching
  When browsing the web, fetching URLs, searching the web, extracting web page content, or needing rendered HTML from a URL
---

# Lightpanda Browser

## Overview

Lightpanda is an open-source headless browser built from scratch in Zig for machine/AI usage. It executes JavaScript, renders the DOM, and can emit Markdown or a semantic tree directly. Use it via CLI shell commands for fast content extraction.

**Status:** Beta. Works for most sites. Complex JS-heavy SPAs may fail -- fall back to Playwright for those.

## Installation

On macOS, Lightpanda is installed persistently by the chezmoi-managed Homebrew bundle:

```bash
brew install lightpanda-io/browser/lightpanda
```

Use the bare `lightpanda` command. Current flags use hyphens, such as
`--strip-mode` and `--log-level`.

## Ideal Command for AI Content Extraction

```bash
lightpanda fetch --dump markdown --strip-mode full --log-level fatal <url>
```

- `--dump markdown` converts the rendered document to Markdown
- `--strip-mode full` removes scripts, stylesheets, images, video, and SVG
- `--log-level fatal` keeps routine logs out of stderr

## CLI Reference

### Commands

| Command   | Purpose                                       |
| --------- | --------------------------------------------- |
| `fetch`   | Fetch a URL, execute JS, dump rendered HTML   |
| `serve`   | Start a CDP server (for Playwright/Puppeteer) |
| `help`    | Show usage                                    |
| `version` | Show version                                  |

### Fetch Options

| Flag                   | Description                                |
| ---------------------- | ------------------------------------------ |
| `--dump <mode>`        | Output `html`, `markdown`, or a semantic tree |
| `--strip-mode <modes>` | Comma-separated: `js`, `css`, `ui`, `invisible`, `full` |
| `--with-base`          | Add `<base>` tag to output                 |

Strip modes:

- `js` -- remove script tags and preload links
- `css` -- remove style tags and stylesheet links
- `ui` -- remove img, picture, video, css, svg
- `full` -- all of the above (recommended for AI)

### Common Options (fetch and serve)

| Flag                               | Default   | Description                               |
| ---------------------------------- | --------- | ----------------------------------------- |
| `--obey-robots`                    | false     | Respect robots.txt                        |
| `--http-proxy <url>`               | none      | HTTP proxy (supports user:pass@host:port) |
| `--proxy-bearer-token <token>`     | none      | Bearer auth for proxy                     |
| `--http-timeout <ms>`              | 10000     | Transfer timeout (0 = no timeout)         |
| `--http-connect-timeout <ms>`      | 0         | Connection timeout (0 = no timeout)       |
| `--http-max-concurrent <n>`        | 40        | Max concurrent HTTP requests              |
| `--http-max-response-size <bytes>` | 1 GiB     | Limit response size                       |
| `--log-level <level>`              | warn      | debug/info/warn/error/fatal               |
| `--log-format <fmt>`               | logfmt    | pretty/logfmt                             |
| `--user-agent-suffix <str>`        | none      | Appended to the Lightpanda user agent     |

### Environment Variables

| Variable                            | Description             |
| ----------------------------------- | ----------------------- |
| `LIGHTPANDA_DISABLE_TELEMETRY=true` | Disable usage telemetry |

## Common Patterns

### Fetch a page (clean content)

```bash
lightpanda fetch --dump markdown --strip-mode full --log-level fatal https://example.com
```

### Fetch with extended timeout (slow sites)

```bash
lightpanda fetch --dump markdown --strip-mode full --log-level fatal --http-timeout 15000 https://example.com
```

### Fetch respecting robots.txt

```bash
lightpanda fetch --dump markdown --strip-mode full --log-level fatal --obey-robots https://example.com
```

### Fetch with base tag (for resolving relative URLs)

```bash
lightpanda fetch --dump markdown --strip-mode full --log-level fatal --with-base https://example.com
```

## Output Behavior

- **stdout**: The format selected by `--dump` after JavaScript execution
- **stderr**: Log messages
- `--log-level fatal` suppresses routine logs without hiding real command errors

## When to Fall Back to Playwright

Use Playwright instead of lightpanda when you need:

- Interactive page manipulation (clicking buttons, filling forms)
- Multi-step navigation with session/cookie state
- Screenshots or visual testing
- Complex JS-heavy SPAs that lightpanda fails to render
- Waiting for specific elements or network conditions
