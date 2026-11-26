# Sharing plain files

Use `toolkit share` when Jerred needs a file or folder and no review loop:
a log, a dataset, a generated asset, a recording to download. For work he should
comment on, publish through `toolkit artifacts` instead.

```bash
toolkit share private <path...> [--keep] [--name <name>] [--json]
toolkit share public  <path...> [--keep] [--name <name>] [--json]
```

- `private` writes to the tailnet-only host (`https://private.tailnet-1a49.ts.net/`).
  It opens only on the tailnet. This is the default for anything for Jerred.
- `public` is readable by anyone on the internet (`https://public.sjer.red/`). Use
  it only when Jerred asked for public sharing. Never put private logs, secrets,
  or personal data there.
- One URL is printed per top-level path; a directory URL ends in `/`. Give Jerred
  the URL, not the local path.
- Objects expire after 30 days; `--keep` stores them without expiry. `--name`
  renames a single path. Files over 16 MiB upload in parts.
- A `.cast` also gets a player page (the printed URL) and a GIF preview; this
  needs `agg` (`brew install agg`).
- `--json` prints one object on stdout; progress goes to stderr.
- `Unknown command: share` means an older toolkit: tell Jerred to run
  `bun run --cwd packages/toolkit install:local`.

## What not to use

Taildrop (`tailscale file cp`), `tailscale serve`, and `toolkit expose` are
Tailscale tools, not the way to show Jerred results: they are per-host, ephemeral,
and carry no feedback. Load `tailscale-helper` only to operate Tailscale itself.

## PR demos

A PR's `## Demo` still uses `toolkit pr asset [PR] <path...> --markdown`: GitHub
cannot reach the tailnet, so it needs a public, embeddable URL.
