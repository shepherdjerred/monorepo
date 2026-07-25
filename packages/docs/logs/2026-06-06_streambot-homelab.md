---
id: log-2026-06-06-streambot-homelab
type: log
status: complete
board: false
---

# StreamBot Homelab Setup

## Context

Added a Kubernetes/CDK8s deployment for [`ysdragon/StreamBot`](https://github.com/ysdragon/StreamBot), a Discord video streaming self-bot with an optional web management interface.

Upstream notes that StreamBot is a Discord self-bot and may violate Discord's Terms of Service. This deployment keeps the web UI private behind Tailscale and expects secrets to be provided through the 1Password Operator.

## Deployment Notes

- ArgoCD app: `streambot`
- Namespace: `streambot`
- Chart: `streambot`
- Image: `quay.io/ydrag0n/streambot:latest@sha256:6bb994bbc70f974092e54580002bf53152e00687dfe40469db06a6a7ef7e4368`
- Web UI: enabled on container port `3000`, exposed as Tailscale host `streambot`
- Storage:
  - `128Gi` ZFS NVMe PVC for `/home/bots/StreamBot/videos`
  - `16Gi` ZFS NVMe PVC for `/home/bots/StreamBot/tmp`
- Expected 1Password item: `streambot-config`
- Expected 1Password fields:
  - `TOKEN`
  - `GUILD_ID`
  - `COMMAND_CHANNEL_ID`
  - `VIDEO_CHANNEL_ID`
  - `ADMIN_IDS`
  - `SERVER_USERNAME`
  - `SERVER_PASSWORD`

## Session Log — 2026-06-06

### Done

- Added the StreamBot CDK8s resource, including deployment, service, Tailscale ingress, PVCs, and 1Password-backed environment variables.
- Added the StreamBot namespace chart and ArgoCD application wiring.
- Added the StreamBot Helm chart metadata and CI catalog entry.
- Added the pinned StreamBot image version to `versions.ts`.

### Remaining

- Create/populate the `streambot-config` item in the homelab 1Password vault with the fields listed above before ArgoCD sync.
- Confirm whether the StreamBot container can run as UID/GID `1000`; if not, adjust the pod security context after inspecting the runtime failure.
- After deployment, verify the Tailscale `https://streambot` ingress and Discord voice streaming flow.

### Caveats

- StreamBot is explicitly described upstream as a Discord self-bot; operating it may violate Discord's Terms of Service.
- The web UI is private via Tailscale, but Discord/video-source egress remains open for HTTP/HTTPS and Discord voice UDP ports.
