---
title: Initialize Matomo
description: Complete the installer over the tailnet and open the public gate for the first time.
sidebar:
  order: 9
---

A fresh Matomo is reachable over the tailnet but returns `503` publicly. The
public gate stays shut until you create a marker file, which is what makes the
first-run installer safe to complete.

Do this once, on a new install.

## 1. Complete the installer over the tailnet

Open `https://matomo.<tailnet>/` and work through the Matomo installer.

The Matomo process is ready here well before the public gate is. That is
expected.

## 2. Verify sites and Custom Dimensions

Before opening the gate, confirm the sites and Custom Dimensions are configured
as you want them. It is much easier to fix now than after traffic arrives.

Check the privacy settings too: IP anonymization, DNT support, no User IDs, and
cookieless tracking should all be enabled.

## 3. Create the marker

```sh
kubectl -n matomo exec deploy/matomo -c matomo -- \
  touch /var/www/html/.matomo-public-ready
```

Only once this marker exists does the public gate proxy requests to Matomo.

## 4. Verify the public path

```sh
curl -fsS https://matomo.sjer.red/matomo.js
```

Check the API endpoint too. Both must succeed **before** you allow the
site-release lane to deploy tracker changes — otherwise the sites ship a tracker
pointing at a 503.

## What the archive sidecar does next

The sidecar waits for the installer to write the database section, then disables
browser-triggered archiving, configures the Cloudflare client-IP header, and
runs `core:archive` every five minutes.

A failed archive exits the sidecar, so Kubernetes reports the pod unhealthy
rather than silently serving stale reports.

## Related

- [Run the Matomo audit](/how-to/run-the-matomo-audit/) — the recurring health check
