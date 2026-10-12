---
title: Cut over Mario Kart to direct HTTPS
description: Verify Caddy certificates and router forwarding before moving the controller hostname off Cloudflare Tunnel.
---

Deploy and verify the direct HTTPS listener before changing the public DNS record.
Keep the existing hostname so Discord OAuth callbacks and secure cookies remain valid.

## 1. Release the HTTPS listener

Deliver the [Mario Kart chart](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/mario-kart.ts)
through the [homelab release workflow](/how-to/cut-a-homelab-release/).
Verify the Caddy Deployment is running and its certificate storage is bound.
Confirm the controller still works through the existing public hostname.

Caddy obtains a public certificate through HTTP-01 on the existing tunnel's
internal bootstrap listener, which forwards ACME challenge paths to Caddy's
HTTP port. Check its logs for successful certificate issuance.
Pod readiness alone does not prove a certificate exists.

## 2. Activate the router forwards

Use the [local router stack](/how-to/apply-the-asuswrt-stack/) to plan the
new HTTP and HTTPS forwards declared in
[router.tf](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/tofu/asuswrt/router.tf).
Apply only a reviewed plan containing the two intended additions.
If those rules already exist, import their matching addresses before planning.
Do not import a new rule that has not been created.
Choose the appropriate mode from the
[router import options](/reference/asuswrt-import/) when adopting existing
forwards.

Check HTTPS directly against the router's home address while preserving the
hostname for TLS. Run from outside the home network to verify WAN forwarding:

```bash
curl --fail --show-error --connect-to mariokart.sjer.red:443:ddns.sjer.red:443 \
  https://mariokart.sjer.red/
```

Require a valid browser-trusted certificate without disabling verification.
Verify HTTP redirects to the canonical HTTPS URL without an internal port.
Exercise the controller WebSocket and video feed through the direct route.
Do not change DNS if these checks fail.

## 3. Release the DNS cutover

In the [Cloudflare stack](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/tofu/cloudflare/sjer-red.tf),
point the existing `sjer_red_cname_mariokart` resource at the dynamic home-IP
hostname and set `proxied = false`. Deliver this as a separate release after
the direct-route checks pass. Keep the tunnel binding available for recovery.

Verify public resolution reaches the home address after caches expire.
Check Discord sign-in, controller input, video playback, and measured ping
through the normal public URL from outside the home network.
The certificate's HTTP-01 renewals now reach Caddy through the router.

## 4. Recover the tunnel route if needed

Restore the DNS resource's tunnel target and `proxied = true` through OpenTofu.
The retained bootstrap listener serves the controller through Cloudflare
without depending on Caddy's public certificate.

## Related

- [About homelab ingress](/explanation/homelab/overview/)
- [Apply the router stack](/how-to/apply-the-asuswrt-stack/)
