# hermes

Containerized trial of [Nous Research's Hermes Agent](https://github.com/NousResearch/hermes-agent).
Design goal: **nothing Hermes-related runs on macOS directly** — the whole stack
lives in Docker (OrbStack), state in named volumes only, no host bind mounts.

## Shape

- `gateway` — the Hermes agent + messaging gateway, built from the pinned
  [official image](https://hub.docker.com/r/nousresearch/hermes-agent) plus
  globally installed Claude Code and Codex CLIs (see `Dockerfile`).
  - Loop provider: ChatGPT/Codex subscription via device-code OAuth.
  - Claude Code subscription is used via the bundled
    [delegation skill](https://hermes-agent.nousresearch.com/docs/user-guide/skills/bundled/autonomous-ai-agents/autonomous-ai-agents-claude-code),
    not as a loop provider.
  - iMessage ingress via [Photon](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/photon)
    (hosted bridge, shared line — no BlueBubbles, no Mac-side component).
- The web dashboard runs inside the gateway container (`HERMES_DASHBOARD=1`,
  s6-supervised — see the [Docker docs](https://hermes-agent.nousresearch.com/docs/user-guide/docker))
  on <http://127.0.0.1:9119>. Its auth gate requires a provider on non-loopback
  binds, so basic auth is fed from `HERMES_DASHBOARD_PASSWORD` in the
  invocation environment (sourced from 1Password at the prompt — never written
  to disk). It is only needed when (re)creating the gateway container; when
  unset the dashboard fails closed and the gateway runs normally.
- `chromium` — real headful Chrome for the
  [browser tools](https://hermes-agent.nousresearch.com/docs/user-guide/features/browser),
  watchable via KasmVNC at <http://127.0.0.1:3000>; CDP is reachable only on the
  compose network (static IP, because Chrome's DevTools endpoint rejects
  non-IP Host headers).

## Run

```bash
HERMES_DASHBOARD_PASSWORD="$(op read 'op://<vault>/<item>/password')" docker compose up -d --build
docker compose exec gateway hermes   # interactive TUI, shares gateway state
```

One-time onboarding (interactive):

1. In the TUI, add the loop provider: ChatGPT/Codex device-code OAuth.
2. `docker compose exec gateway claude` → `/login` (Claude subscription);
   creds persist in the `hermes-home` volume.
3. `docker compose exec gateway hermes photon setup --phone <number>`, then
   text the assigned line first (the free shared tier cannot initiate).
4. Keep `approvals.mode: manual` in `/opt/data/config.yaml`
   ([security docs](https://hermes-agent.nousresearch.com/docs/user-guide/security)).

Teardown: `docker compose down` (state survives in volumes); add `-v` to erase
all state including OAuth creds and the browser profile.

## Known issue on the pinned tag

`hermes photon setup` on `v2026.9.11` installs an incomplete sidecar bundle
into `/opt/data/photon/sidecar` (missing `send-format.mjs` and
`stream-staleness.mjs`), so the sidecar exits 1 before becoming ready — same
family as upstream [#48659](https://github.com/NousResearch/hermes-agent/issues/48659).
Repair (the gateway's reconnection watcher then picks Photon back up):

```bash
docker compose exec gateway sh -c 'cp -p /opt/hermes/plugins/platforms/photon/sidecar/send-format.mjs /opt/hermes/plugins/platforms/photon/sidecar/stream-staleness.mjs /opt/data/photon/sidecar/'
```

## Notes

- The `chromium-config` volume holds a logged-in browser profile — treat it as
  secret-grade. Never publish the CDP port to the host.
- Deferred ideas: 1Password approval-broker sidecar, tailnet exposure,
  pinchtab attached to the same Chrome, dedicated Photon number, graduation to
  `packages/homelab` + the cluster (nothing here is Mac-bound).
