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
  binds, so basic auth is fed from `HERMES_DASHBOARD_PASSWORD` at `up` time
  (put it in a local gitignored `.env`, e.g. from 1Password; never commit it).
- `chromium` — real headful Chrome for the
  [browser tools](https://hermes-agent.nousresearch.com/docs/user-guide/features/browser),
  watchable via KasmVNC at <http://127.0.0.1:3000>; CDP is reachable only on the
  compose network (static IP, because Chrome's DevTools endpoint rejects
  non-IP Host headers).

## Run

```bash
printf 'HERMES_DASHBOARD_PASSWORD=%s\n' "$(op read 'op://<vault>/<item>/password')" > .env
docker compose up -d --build
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

## Notes

- The `chromium-config` volume holds a logged-in browser profile — treat it as
  secret-grade. Never publish the CDP port to the host.
- Deferred ideas: 1Password approval-broker sidecar, tailnet exposure,
  pinchtab attached to the same Chrome, dedicated Photon number, graduation to
  `packages/homelab` + the cluster (nothing here is Mac-bound).
