---
title: Matomo analytics
description: Self-hosted analytics operations and cutover checks.
---

Matomo runs in the `matomo` namespace with a MariaDB backend. The application
volume and database volume are covered by the normal PVC backup policy.

## First-run initialization

The Matomo process is ready through the Tailscale endpoint while the public
Cloudflare gate returns `503` until the operator completes the installer and
privacy setup. Complete the installer through `https://matomo.<tailnet>/`,
verify the sites and Custom Dimensions, then create the marker inside the
Matomo container:

```sh
kubectl -n matomo exec deploy/matomo -c matomo -- \
  touch /var/www/html/.matomo-public-ready
```

Only after that marker exists does the public gate proxy requests to Matomo.
Verify `https://matomo.sjer.red/matomo.js` and the API endpoint before allowing
the site-release lane to deploy tracker changes.

The archive sidecar disables browser-triggered archiving, configures the
Cloudflare client-IP header, and runs `core:archive` every five minutes. A
failed archive exits the sidecar so Kubernetes reports the pod as unhealthy.

## Audit checks

- `argocd app get matomo` is `Synced` and `Healthy`.
- Both Matomo containers and MariaDB are ready, with no restart loop.
- `curl -fsS https://matomo.sjer.red/matomo.js` succeeds after the marker is created.
- The archive sidecar logs successful `core:archive` runs.
- Matomo privacy settings keep IP anonymization, DNT support, no User IDs,
  and cookieless tracking enabled.
