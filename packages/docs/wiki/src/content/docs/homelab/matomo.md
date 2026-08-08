---
title: Matomo analytics
description: Self-hosted analytics operations and cutover checks.
---

Matomo runs in the `matomo` namespace with a MariaDB backend. The application
volume and database volume are covered by the normal PVC backup policy.

## First-run initialization

The Matomo pod's public Service remains without ready endpoints until
`/var/www/html/config/config.ini.php` exists. Complete the installer through
the Tailscale endpoint at `https://matomo.<tailnet>/`, then verify the public
endpoint at `https://matomo.sjer.red`.

The archive sidecar disables browser-triggered archiving, configures the
Cloudflare client-IP header, and runs `core:archive` every five minutes. A
failed archive exits the sidecar so Kubernetes reports the pod as unhealthy.

## Audit checks

- `argocd app get matomo` is `Synced` and `Healthy`.
- Both Matomo containers and MariaDB are ready, with no restart loop.
- `curl -fsS https://matomo.sjer.red/matomo.js` succeeds.
- The archive sidecar logs successful `core:archive` runs.
- Matomo privacy settings keep IP anonymization, DNT support, no User IDs,
  and cookieless tracking enabled.
