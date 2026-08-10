---
title: Run the Matomo audit
description: The recurring health check for self-hosted analytics — deployment, archiving, the public path, and privacy settings.
sidebar:
  order: 10
---

Run these checks when analytics look wrong, after a Matomo upgrade, or as a
periodic sweep.

## 1. Deployment health

```sh
argocd app get matomo
```

Expect `Synced` and `Healthy`.

Then confirm all four components are ready with no restart loop: the Matomo
process, the archive sidecar, the public gate, and MariaDB.

## 2. Archiving

Check the archive sidecar logs for successful `core:archive` runs. It should run
every five minutes.

A failed archive exits the sidecar, so a crash-looping sidecar means archiving
is broken — reports go stale quietly rather than erroring.

## 3. Public path

```sh
curl -fsS https://matomo.sjer.red/matomo.js
```

Check the API endpoint too.

This only succeeds once the first-run marker exists. On a fresh install it is
expected to fail until you [initialize Matomo](/how-to/initialize-matomo/).

## 4. Privacy settings

Confirm all four are still enabled:

- IP anonymization
- DNT support
- No User IDs
- Cookieless tracking

These are easy to lose across an upgrade, and nothing else will tell you.

## Related

- [Initialize Matomo](/how-to/initialize-matomo/)
