---
id: sjer-red-mta-sts
status: deferred
origin: packages/docs/plans/2026-05-25_sjer-red-hardening.md
---

# Publish MTA-STS policies for mail-receiving zones

Deferred from the 2026-05-25 sjer.red hardening PR (which user requested be a single PR; MTA-STS infra didn't fit).

## Why deferred

MTA-STS (RFC 8461) requires each receiving zone to:

1. Publish a `_mta-sts.<zone>` TXT record with `v=STSv1; id=<rotating-version>`.
2. Serve a policy file at `https://mta-sts.<zone>/.well-known/mta-sts.txt`.

The 2026-05-25 PR shipped TLSRPT (Item 4d) and the CAA / TLS / HSTS / DMARC / timing-safe / temporal-binding items inline. MTA-STS hosting was deferred because it needs **per-zone static site infrastructure** in [packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts](packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts) plus content publication into new SeaweedFS buckets — a separate piece of work that warranted its own design.

## Scope

Three mail-receiving zones (`sjer.red`, `shepherdjerred.com`, `ts-mc.net`). For each:

- New SeaweedFS bucket (`mta-sts-<zone>` style), provisioned in [packages/homelab/src/tofu/seaweedfs/buckets.tf](packages/homelab/src/tofu/seaweedfs/buckets.tf).
- New entry in [packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts](packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts) with `hostname: "mta-sts.<zone>"`, `bucket: "mta-sts-<zone>"`.
- One file uploaded to the bucket at key `.well-known/mta-sts.txt` containing:

  ```text
  version: STSv1
  mode: testing
  mx: in1-smtp.messagingengine.com
  mx: in2-smtp.messagingengine.com
  max_age: 604800
  ```

- New `_mta-sts.<zone>` TXT record in the corresponding zone .tf file:

  ```hcl
  resource "cloudflare_dns_record" "<zone>_mta_sts" {
    zone_id = cloudflare_zone.<zone>.id
    ttl     = 1
    name    = "_mta-sts"
    type    = "TXT"
    content = "v=STSv1; id=20260525T000000Z"
  }
  ```

- New `mta-sts.<zone>` CNAME → `${TUNNEL_ID}.cfargotunnel.com` in the corresponding zone .tf file (mirroring the pattern used by existing static sites).

## Rollout

1. Land everything in `mode: testing` — senders **report** failures, they don't refuse delivery. Watch the TLSRPT inbox (`dmarc@sjer.red`, already configured in the 2026-05-25 hardening PR) for two weeks.
2. After clean TLSRPT reports, flip `mode: testing` → `mode: enforce` and rotate the `id` in the TXT record. Senders will then refuse delivery to any MX cert that doesn't match policy.

## Considerations

- **Bucket content publication.** Investigate how existing static sites (e.g., `webring`, `cook`) get content into their SeaweedFS buckets. Likely a CI step or a one-shot `op run -- aws s3 cp` from the build host. The MTA-STS file is static and 5 lines — a manual one-shot upload is acceptable for the initial rollout.
- **Caddy reverse-proxy.** The existing `S3StaticSites` chart serves the bucket root via Caddy; verify it serves `/.well-known/mta-sts.txt` correctly without rewrites (no `reverseProxies` or `spaFallbacks` needed for this hostname).
- **Single bucket option.** All three zones could share one bucket since the policy content is identical — but each hostname still needs its own static-site binding because RFC 8461 mandates per-zone `mta-sts.<zone>` hostnames. The bucket-sharing optimization is a minor savings; per-zone buckets are simpler to reason about.
- **`id` rotation discipline.** Every policy change (mode flip, MX update) needs the TXT record `id` bumped or senders will keep using the cached policy until the previous `max_age` expires. Use an ISO-8601-style timestamp (`20260525T000000Z`).
