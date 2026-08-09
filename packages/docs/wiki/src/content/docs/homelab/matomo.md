---
title: Matomo analytics
description: Self-hosted analytics operations and checks.
---

Matomo runs in the `matomo` namespace with a MariaDB backend. The application
volume and database volume are covered by the normal PVC backup policy. A
single Service serves both the Tailscale ingress and the Cloudflare tunnel.

## First-run initialization

Complete the installer through `https://matomo.<tailnet>/`, then verify the
sites and Custom Dimensions. Site IDs are not arbitrary: they are pinned in
`config/analytics-sites.json` and hard-coded into each tracker snippet, so
websites must be created in registry order (`sjer.red` first, at ID 1).

The archive sidecar waits for the installer to write the `[database]` section
before doing anything. Until then it idles rather than crash-looping — this
matters because a crash-looping container makes the pod not-Ready, which pulls
it out of the Service endpoints and makes the installer itself unreachable.
Once the section exists it disables browser-triggered archiving, configures the
Cloudflare client-IP header, and runs `core:archive` every five minutes. A
failed archive exits the sidecar so Kubernetes reports the pod as unhealthy.

The official Matomo image keeps its root entrypoint so it can initialize the
shared application volume, with privilege escalation disabled.

## Audit checks

- `argocd app get matomo` is `Synced` and `Healthy`.
- The Matomo process, archive sidecar, and MariaDB are ready, with no restart loop.
- `curl -fsS https://matomo.sjer.red/matomo.js` succeeds.
- `https://matomo.sjer.red/matomo.php` returns 200 with a non-empty body. This
  is the tunnel's public probe path; note that `matomo.php` is the tracker
  entry point and does **not** implement `module=API`, so probing
  `API.getMatomoVersion` there returns 400.
- The archive sidecar logs successful `core:archive` runs.
- Matomo privacy settings keep IP anonymization, DNT support, no User IDs,
  and cookieless tracking enabled.
