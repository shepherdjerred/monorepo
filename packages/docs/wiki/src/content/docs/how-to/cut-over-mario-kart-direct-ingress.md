---
title: Cut over Arcade to its public hostname
description: Configure Arcade's canonical DNS, TLS, Discord callback, and tunnel recovery while retiring previous game aliases.
---

Prepare the Arcade hostname and Discord callback before switching the controller's canonical origin.

## 1. Register the Discord callback

In the preserved application's Discord Developer Portal, open OAuth2 settings.
Add the Arcade origin followed by `/api/auth/discord/callback` to Redirects and save.
Keep localhost callbacks only where local development needs them.
Do not switch the application origin until the new callback is registered.

Use the same application and credentials described in
[Arcade account migration](/how-to/migrate-game-bots-to-arcade/).

## 2. Release DNS and the HTTPS listener

Deliver the [Arcade edge](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/arcade-edge.ts)
for the canonical hostname through the [homelab release workflow](/how-to/cut-a-homelab-release/).
Keep the old canonical origin active during this release.
For an existing listener, complete the [namespace migration](/how-to/migrate-game-bots-to-arcade/#move-the-web-edge-between-namespaces)
before transferring its public ports.

In the [Cloudflare stack](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/tofu/cloudflare/sjer-red.tf),
point `sjer_red_cname_arcade` at the [IPv4-only dynamic target](/reference/dynamic-dns/)
with `proxied = false`. Verify that the target resolves without an AAAA record.
Retain the existing HTTP and HTTPS [router forwards](/how-to/apply-the-asuswrt-stack/)
and certificate storage; this hostname change does not require replacing them.

Verify public DNS and HTTPS from outside the home network:

```bash
curl --fail --show-error https://arcade.sjer.red/
```

Require HTTP 200 and a browser-trusted certificate without disabling verification.
Check Caddy's certificate-loading or HTTP-01 issuance logs.
Pod readiness alone does not prove a certificate exists.
Do not switch the canonical origin if these checks fail.

## 3. Switch the canonical origin

Set `WEB_PUBLIC_ORIGIN` in the
[Arcade chart](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/arcade.ts)
to `https://arcade.sjer.red` in a separate release.
Deploy the [Arcade Caddy configuration](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/arcade-caddyfile.ts)
with it. Retain the edge's health and ACME handlers before controller host matching.

Remove the old Mario Kart and Pokébot DNS records through OpenTofu.
Retire their tunnel bindings, private ingresses, redirect service, and probes through the guarded release path.
Check that previous game hostnames no longer reach Arcade, including cached addresses and private aliases.
The bootstrap listener must return HTTP 404 for noncanonical controller hosts.

Open a fresh Discord controller link and sign in again on the Arcade hostname.
Verify controller input, video, audio, and ping through the new public route.
Existing browser sessions use host-specific cookies; users must sign in again.
After verifying the new login flow, remove obsolete game-host callbacks from the Discord application.

## 4. Recover if verification fails

For an application rollback, restore the previous application version through
GitOps while retaining Arcade's canonical hostname and certificate.
Keep all game storage claims and the shared edge's certificate claim.

For a direct-route failure, restore the Arcade DNS resource's tunnel target
and `proxied = true` through OpenTofu.
The retained Arcade tunnel binding serves the canonical hostname through the
bootstrap listener without depending on Caddy's public certificate.
Keep health and HTTP-01 challenge paths reachable on that listener.

## Related

- [About homelab ingress](/explanation/homelab/overview/)
- [Apply the router stack](/how-to/apply-the-asuswrt-stack/)
