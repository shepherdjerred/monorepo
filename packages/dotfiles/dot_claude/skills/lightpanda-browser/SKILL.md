---
name: lightpanda-browser
description: |
  Lightpanda headless browser CLI for fast web content extraction, searching, and fetching
  When browsing the web, fetching URLs, searching the web, extracting web page content, or needing rendered HTML from a URL
---

# Lightpanda Browser

## Overview

Lightpanda is an open-source headless browser built from scratch in Zig for machine/AI usage. It executes JavaScript and renders the DOM like Chrome, but is 11x faster, uses 9x less memory, and has instant startup. Use it via CLI shell commands instead of Playwright or WebFetch.

**Status:** Beta. Works for most sites. Complex JS-heavy SPAs may fail -- fall back to Playwright for those.

## Ideal Command for AI Content Extraction

```bash
lightpanda fetch --dump --strip_mode full --log_level fatal <url>
```

- `--dump` outputs rendered HTML to stdout
- `--strip_mode full` removes scripts, stylesheets, images, video, SVGs -- leaves just content
- `--log_level fatal` silences all log output on stderr

## CLI Reference

### Commands

| Command | Purpose |
|---------|---------|
| `fetch` | Fetch a URL, execute JS, dump rendered HTML |
| `serve` | Start a CDP server (for Playwright/Puppeteer) |
| `help` | Show usage |
| `version` | Show version |

### Fetch Options

| Flag | Description |
|------|-------------|
| `--dump` | Output rendered HTML to stdout |
| `--strip_mode <modes>` | Comma-separated: `js`, `css`, `ui`, `full` |
| `--with_base` | Add `<base>` tag to output |

Strip modes:
- `js` -- remove script tags and preload links
- `css` -- remove style tags and stylesheet links
- `ui` -- remove img, picture, video, css, svg
- `full` -- all of the above (recommended for AI)

### Common Options (fetch and serve)

| Flag | Default | Description |
|------|---------|-------------|
| `--obey_robots` | false | Respect robots.txt |
| `--http_proxy <url>` | none | HTTP proxy (supports user:pass@host:port) |
| `--proxy_bearer_token <token>` | none | Bearer auth for proxy |
| `--http_timeout <ms>` | 5000 | Transfer timeout (0 = no timeout) |
| `--http_connect_timeout <ms>` | 0 | Connection timeout (0 = no timeout) |
| `--http_max_concurrent <n>` | 10 | Max concurrent HTTP requests |
| `--http_max_response_size <bytes>` | unlimited | Limit response size |
| `--log_level <level>` | warn | debug/info/warn/error/fatal |
| `--log_format <fmt>` | logfmt | pretty/logfmt |
| `--user_agent_suffix <str>` | none | Appended to "Lightpanda/1.0" |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `LIGHTPANDA_DISABLE_TELEMETRY=true` | Disable usage telemetry |

## Common Patterns

### Fetch a page (clean content)

```bash
lightpanda fetch --dump --strip_mode full --log_level fatal https://example.com
```

### Search the web via DuckDuckGo

```bash
lightpanda fetch --dump --strip_mode full --log_level fatal "https://duckduckgo.com/html/?q=search+terms+here"
```

Use the `/html/` endpoint for simpler, lighter HTML output from DuckDuckGo.

### Fetch with extended timeout (slow sites)

```bash
lightpanda fetch --dump --strip_mode full --log_level fatal --http_timeout 15000 https://slow-site.com
```

### Fetch respecting robots.txt

```bash
lightpanda fetch --dump --strip_mode full --log_level fatal --obey_robots https://example.com
```

### Fetch with base tag (for resolving relative URLs)

```bash
lightpanda fetch --dump --strip_mode full --log_level fatal --with_base https://example.com
```

## Output Behavior

- **stdout**: Rendered HTML (after JS execution)
- **stderr**: Log messages
- `--log_level fatal` or `2>/dev/null` gives clean stdout-only output
- Output is HTML, not markdown. Parse it directly or use shell tools to extract text.

## When to Fall Back to Playwright

Use Playwright instead of lightpanda when you need:
- Interactive page manipulation (clicking buttons, filling forms)
- Multi-step navigation with session/cookie state
- Screenshots or visual testing
- Complex JS-heavy SPAs that lightpanda fails to render
- Waiting for specific elements or network conditions

## Installation

macOS (Apple Silicon):
```bash
curl -L -o /usr/local/bin/lightpanda https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-macos && chmod a+x /usr/local/bin/lightpanda
```

macOS (Intel):
```bash
curl -L -o /usr/local/bin/lightpanda https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-macos && chmod a+x /usr/local/bin/lightpanda
```

Linux (x86_64):
```bash
curl -L -o /usr/local/bin/lightpanda https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux && chmod a+x /usr/local/bin/lightpanda
```

Linux (aarch64):
```bash
curl -L -o /usr/local/bin/lightpanda https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-linux && chmod a+x /usr/local/bin/lightpanda
```
