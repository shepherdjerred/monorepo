---
title: How to onboard a Fastmail domain
description: Adopt a Cloudflare domain, route its email to the existing Fastmail inbox, and activate transport policy after verification.
---

Add the domain to Fastmail before releasing its Cloudflare mail records.
Use the [OpenTofu infrastructure contract](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/tofu/README.md) for source files and validation commands.

1. Verify the registrar has auto-renew, transfer lock, and privacy enabled.
   Confirm MFA protects both Cloudflare and Fastmail accounts.
   Keep Cloudflare authoritative for DNS.

2. Add the domain in Fastmail's domain settings.
   Preserve existing users and addresses.
   Add `root@domain` as a sending address and route the domain catch-all to the existing inbox.
   Confirm `dmarc@sjer.red` receives reports.
   Follow Fastmail's [email authentication instructions](https://www.fastmail.help/hc/en-us/articles/360058753394) and use **Recheck** after DNS deploys.

3. Add the domain to `packages/homelab/src/domain-registry.json` with `mtaStsPublished: false`.
   Set `fastmailReady: true` after confirming account-side domain onboarding; keep it false until then.
   Add the existing Cloudflare zone resource, its declarative import, and the `baseline_zone_ids` binding.
   Preserve website records, redirects, existing subdomain mail routing, and Postal selectors.
   Enable wildcard inbound MX only when using Fastmail subdomain addressing.

4. Run the focused OpenTofu, CDK8s, Caddy, and Tunnel DNS coverage checks from the infrastructure contract.
   Review the full credentialed plan for unexpected removals or zone replacements.
   Confirm CI's Cloudflare token has `SSL and Certificates Write` before enabling CT alerting resources.
   Use the isolated token stack's saved-plan workflow for any required permission update.

5. Release through the [homelab release workflow](/how-to/cut-a-homelab-release/).
   Verify the intended chart revision reconciles before accepting the deployment.
   The [static-site construct](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/misc/s3-static-site.ts) serves policy hosts through the existing Tunnel.

6. Check public MX, SPF, all three DKIM selectors, DMARC, TLS reporting, and CAA.
   Query DS and DNSKEY with a validating resolver and confirm the authenticated-data flag.
   For Cloudflare Registrar domains, verify the parent DS after enabling DNSSEC.
   Check HTTPS, the TLS minimum, HSTS, CT monitoring, and existing website routes.

7. Set `POLICY_URL` to the domain's HTTPS policy URL and fetch it without following redirects:

   ```bash
   curl --fail --max-time 10 --include "$POLICY_URL"
   ```

   Require HTTP 200, a valid certificate, plain text, and the exact registry policy, including the final newline.
   Confirm the public body-aware probes pass.
   Verify STARTTLS for both MX hosts from a network that permits outbound SMTP:

   ```bash
   openssl s_client -starttls smtp -connect in1-smtp.messagingengine.com:25 \
     -servername in1-smtp.messagingengine.com -verify_hostname in1-smtp.messagingengine.com \
     -verify_return_error -min_protocol TLSv1.2 -brief
   ```

   Repeat for `in2-smtp.messagingengine.com` and require successful certificate verification.

8. Set `mtaStsPublished: true` and release the discovery TXT through OpenTofu.
   Its precondition checks the public policy before publishing the content-derived revision.
   Policy content changes automatically change the discovery revision.

9. With the mailbox owner's participation, send and receive mail at `root@domain` and a fresh random catch-all address.
   Inspect external message headers for SPF, DKIM, and DMARC passes.
   Confirm existing aliases and Postal delivery still work.
   Run a subsequent full OpenTofu plan and require no changes.

## Related

- [Homelab architecture](/explanation/homelab/overview/)
- [Postal SMTP transport](/explanation/homelab/postal-smtp-tls/)
