# Publishing

Authoritative source: `toolkit artifacts guide publishing` and
`toolkit artifacts guide sandbox` (rendered by the service from its live limits
and CSP). This page is the working summary.

```bash
toolkit artifacts publish <path...> [--board <slug>] [--title T] [--note-file F]
    [--label A,B,C] [--viewport 1440x900] [--version-of <id>] [--kind K] [--json]
```

## What to publish

Publish the real file, never pasted content.

| You have                 | Publish                          | Viewer         |
| ------------------------ | -------------------------------- | -------------- |
| Typst or other document  | the compiled `.pdf`              | PDF pages      |
| One HTML page            | the `.html` file                 | sandboxed frame |
| A built site             | the directory (needs `index.html`) | sandboxed frame |
| Screenshot or mockup     | `.png` `.jpg` `.webp` `.svg`     | image          |
| Recording                | `.mp4` `.webm` `.mov`            | video          |
| Terminal session         | `.cast`                          | cast player    |
| Diagram                  | the `.mmd` source                | rendered Mermaid |
| Notes                    | `.md`                            | markdown       |
| Anything else            | the file                         | download card  |

Kind follows the entry file; `--kind` overrides it.

## Boards, versions, notes

- Several paths in one call land on one board. A single artifact without
  `--board` gets a board named after it. Use one board per topic, not per file.
- `--version-of <artifactId>` adds a version. Comments stay on the version they
  were made on and show as "on v1". If someone published since, the command exits
  2 naming the current version; re-run against that.
- `--note-file` is a short markdown note shown with the version: what changed and
  what to look at.
- `--viewport WxH` fixes the size an HTML page is shown at. Set it on every UI
  concept (390x844 mobile, 1440x900 desktop).
- Re-running the same publish resends only missing files, and an unchanged
  republish reports `deduplicated`.
- `--json` prints one report on stdout: artifact ids, versions, review URLs,
  board URL.

## Limits

500 MiB per file, 1 GiB per version, 2000 files. Paths are relative, with no
`..`, no backslashes, no symbolic links, and no leading underscore. Boards expire
after 90 idle days unless kept. Read the live numbers from `toolkit artifacts guide`.

## Sandbox rules (HTML and sites)

The page runs in a sandboxed frame with an opaque origin and a strict CSP.

- Relative URLs only: `./app.js`, `assets/logo.png`. `/assets/app.js` fails.
  Configure the bundler for a relative base (Vite `base: "./"`).
- Hash routing only (`#/page`). `pushState` to another path breaks relative loads
  and reloads as 404. Multi-page sites with relative links are fine.
- No `localStorage`, `sessionStorage`, `indexedDB`, cookies, or service workers;
  they throw or do nothing. Keep state in memory or the hash.
- `alert`, `confirm`, `prompt` do nothing. No popups, forms, or navigating away.
- The only network is the artifact's own files (`fetch('./data.json')`).
  No other origin, WebSocket, or beacon.
- Bundle images, fonts, and scripts, or load scripts, styles, and fonts from the
  allowed CDNs (`toolkit artifacts guide sandbox` lists them: jsDelivr, cdnjs,
  unpkg, Google Fonts).
- Markdown is rendered by the viewer; raw HTML in it does nothing.

Open the page from a local static server before publishing and confirm it loads
with the network tab limited to its own files.

## Output

Text output starts with `Review: <url>`, then `Board: <url>`, then
`Next: toolkit artifacts wait`. Content URLs carry a capability token that the CLI
redacts as `/_t/[redacted]/`; never reconstruct or paste one.
