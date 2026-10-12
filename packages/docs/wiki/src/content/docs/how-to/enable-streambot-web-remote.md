---
title: How to enable the Streambot web remote
description: Provision Discord OAuth and activate the remote through the homelab release path.
---

Activate the remote only after its Discord OAuth credential and redirect are provisioned.

1. Use the existing command bot's Discord application. Add its OAuth client secret
   as `DISCORD_CLIENT_SECRET` in the owning `streambot-config` 1Password item.
   Use the configured password-manager workflow; never put the value in source or a shell argument.
   Refresh the committed vault snapshot and run the homelab `check:1password` script.
2. Register the public origin's `/api/auth/discord/callback` redirect on that application.
   The [Discord OpenTofu provider](https://registry.terraform.io/providers/Alpaca744/discord/0.1.3/docs/resources/application_settings) manages application settings but does not
   expose OAuth redirects. Use the application's OAuth settings for this unsupported
   field, and preserve every existing redirect.
3. Pass the declared public origin as the web bootstrap argument to
   `createStreambotDeployment` in the owning media chart. This adds the required
   secret reference, web listener, health probes, and internal Service.
   The [deployment source](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/streambot/streambot.ts)
   owns this wiring. In the same activation change, add a shared tunnel binding
   with `createCloudflareTunnelBinding` for service `streambot-web`, subdomain
   `streambot`, port `8080`, and both probe paths `/readyz`. Add the matching
   `streambot` CNAME to the Cloudflare OpenTofu stack after the internal web origin is ready.
4. Enable the web remote gate for the intended beta server or users.
   Consult the package README and feature-flag inventory for the exact keys and defaults.
   Keep the existing assistant gate enabled when testing pause, resume, or play-now.
5. Build and publish through CI, then reconcile the media application through the
   [homelab release workflow](/how-to/cut-a-homelab-release/).
   Verify backend readiness and the public page independently of CI.
6. Sign in, join a Discord voice channel, and queue a local title.
   Verify playback in Discord, then test seek, pause/resume, queue editing, and an actual subtitle track.
   Open a second viewer's page and verify that a stale queue edit is rejected after the first viewer changes it.

## Related

- [Web remote architecture](/explanation/streambot-web-remote/)
- [Playback transports](/explanation/streambot-transports/)
