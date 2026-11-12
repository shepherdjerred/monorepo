---
title: Capture raw agent requests
description: Turn on Brim's local capture proxy so the exact requests Claude Code and Codex send are recorded, deduplicated, redacted, and readable next to each session.
sidebar:
  order: 46
---

This guide turns on request capture on a Mac, confirms it works, and purges
captured data. [Agent request capture](/explanation/agent-request-capture/)
explains why it is a proxy and what it keeps.

## Before you start

- `toolkit` and `brim` are installed from this checkout
  (`cd packages/toolkit && bun run install:local`).
- The history daemon runs (`toolkit history daemon status`). It ingests what
  the proxy records.
- `uv` is installed (the Brewfile has it). The proxy runs a pinned
  `mitmdump` through `uvx`, so its first start downloads it.

## Turn capture on

1. Enable it in `~/.toolkit/config.toml`. `clis` defaults to the two verified
   CLIs; add others only to verify them (see the matrix below).

   ```toml
   [brim.capture]
   enabled = true
   # port = 47821
   # retention.days = 30
   # clis = ["claude", "codex"]
   ```

2. Install the proxy. This generates the capture CA under
   `~/.toolkit/brim-capture/ca` and starts the
   `com.jerred.brim-capture` LaunchAgent.

   ```bash
   brim capture install
   ```

3. Apply the agent wrapper from the dotfiles source, so every wrapped agent
   picks up the proxy environment.

   ```bash
   chezmoi diff ~/.local/share/agent-bin/agent-exec
   chezmoi apply ~/.local/share/agent-bin/agent-exec
   ```

4. Check the result. `Proxy` should say `listening`, the CA should be valid,
   and the wrapped CLIs are starred.

   ```bash
   brim capture status
   ```

Agents started before step 3 are not captured; restart them.

:::caution
While capture is on, a wrapper refuses to start a wrapped agent when the proxy
is down: `brim capture env` exits 1 and names the fix. Run
`brim capture install` again, or turn `enabled` off.
:::

## Confirm it end to end

1. Run one short prompt through a wrapper.

   ```bash
   claude -p "reply with the single word ok"
   ```

2. Within a minute the history daemon ingests the spool. List the newest
   captures.

   ```bash
   curl --unix-socket ~/.toolkit/history/daemon.sock 'http://history/v1/captures?limit=5'
   ```

3. Open one. The response carries the rebuilt system prompt, tools, and
   messages, the response text, token usage including cache reads and writes,
   and the blocks that request added.

   ```bash
   curl --unix-socket ~/.toolkit/history/daemon.sock 'http://history/v1/captures/<ID>'
   ```

`/v1/captures?session=<history id>` lists the captures for one session from
`/v1/sessions`. Brim's Sessions window reads the same endpoints.

## Which CLIs can be captured

Verified means a real prompt was captured through `brim capture env`. The
other rows come from binary strings and public docs, and their routes are
marked `verified: false` in
[`clis.ts`](packages/toolkit/src/lib/brim/capture/clis.ts).

| CLI            | Status     | Trust variable         | Recorded route                                               | Session link               |
| -------------- | ---------- | ---------------------- | ------------------------------------------------------------ | -------------------------- |
| `claude`       | verified   | `NODE_EXTRA_CA_CERTS`  | `POST api.anthropic.com/v1/messages`                         | `x-claude-code-session-id` |
| `codex`        | verified   | `CODEX_CA_CERTIFICATE` | WebSocket `chatgpt.com/backend-api/codex/responses`          | `thread-id`                |
| `grok`         | TLS only   | `SSL_CERT_FILE` bundle | `POST api.x.ai/v1/…` (unverified)                            | time and directory         |
| `agy`          | TLS only   | `SSL_CERT_FILE` bundle | `POST cloudcode-pa.googleapis.com/v1internal:…` (unverified) | time and directory         |
| `muse`         | TLS only   | `SSL_CERT_FILE` bundle | `POST api.meta.ai/v1/…` (unverified)                         | none (no history)          |
| `kimi`         | unverified | `NODE_EXTRA_CA_CERTS`  | `POST api.kimi.{com,ai}/coding/v1/…`                         | none (no history)          |
| `cursor-agent` | unverified | `NODE_EXTRA_CA_CERTS`  | `POST api2.cursor.sh/aiserver.v1.…` (protobuf)               | time and directory         |

TLS only means the CLI trusted the capture CA but was not logged in, so no
inference was seen. To verify one on a logged-in Mac:

1. Add it to `clis`, then rerun `brim capture install`.
2. Run one prompt through its wrapper.
3. Read `/v1/captures?limit=5`. If nothing arrived, the route or host is
   wrong. Stop the proxy (`brim capture uninstall`), run a one-off proxy that
   prints each URL but no bodies, run the prompt again, and correct `clis.ts`
   from what it prints. A host outside the CA's name constraints shows up as
   a certificate error in the CLI instead.

   ```bash
   uvx --from mitmproxy==12.2.1 mitmdump --listen-host 127.0.0.1 \
     --listen-port 47821 --set confdir=$HOME/.toolkit/brim-capture/mitmproxy \
     --set upstream_cert=false --set flow_detail=1
   ```

4. Set its status and `verified: true` in `clis.ts`, and update this table.

## Purge captured data

- **A leaked credential.** Captures are redacted with the
  [`brim sync` patterns](packages/toolkit/src/lib/brim/sync/redact.ts) before
  they are stored. After adding a pattern, rewrite what is already stored.
  `brim sync redact` runs the same pass.

  ```bash
  brim capture redact --dry-run
  brim capture redact
  ```

- **Everything.** Stop the proxy and the daemon, delete the store and the
  spool, then start the daemon again.

  ```bash
  brim capture uninstall
  toolkit history daemon stop
  rm ~/.toolkit/history/captures.sqlite*
  rm -r ~/.toolkit/brim-capture/spool
  toolkit history daemon start
  ```

- **Turn it off.** Set `enabled = false` and run `brim capture uninstall`.
  Wrappers then start agents without the proxy. Captures older than
  `retention.days` are deleted on every daemon scan.

## When something fails

| Symptom                                     | Fix                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `no proxy is listening on 127.0.0.1:47821`  | `brim capture install`; read `~/.toolkit/brim-capture/logs/launchd.stderr.log`                        |
| An agent reports a certificate error        | It started before the CA was regenerated; restart it                                                  |
| `brim capture status` shows a growing spool | The daemon is not ingesting; read `capture ingest failed` in its log under `~/.toolkit/history/logs/` |
| A capture's `contextComplete` is false      | The proxy started mid-session, so the request it continues was never captured                         |

## Related

- [Agent request capture](/explanation/agent-request-capture/) — the design
  and its limits
- [Sync agent history across machines](/how-to/sync-agent-history-across-machines/)
  — the transcript archive; captures stay on the machine
