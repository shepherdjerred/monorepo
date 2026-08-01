---
id: log-postal-dns-assessment-2026-07-29
type: log
status: in-progress
board: false
---

# Postal DNS Assessment and Correction

Assessment and GitOps correction of the DNS warning shown for Postal's
`sjer.red` mail domain.

## Session Log — 2026-07-29

### Done

- Confirmed the warning is caused by Postal's packaged
  `spf.postal.example.com` default. The live deployment sets
  `DNS_RETURN_PATH_DOMAIN=rp.sjer.red` but does not override
  `DNS_SPF_INCLUDE` or `DNS_MX_RECORDS`.
- Confirmed live apex SPF is
  `v=spf1 include:spf.messagingengine.com -all`, matching the actual Fastmail
  relay, and DMARC is `p=reject`.
- Confirmed the current Postal DKIM selector is published and Postal reports it
  as `OK`.
- Confirmed recent Postal messages use an `@rp.sjer.red` envelope sender and
  Fastmail accepted them with SMTP `2.0.0`.
- Confirmed apex and `rp.sjer.red` MX records intentionally point to Fastmail.
  Postal is not configured as the public inbound mail exchanger.
- Identified the durable correction: set
  `DNS_SPF_INCLUDE=spf.messagingengine.com` on every Postal component and
  re-run the domain check. No public SPF record change is needed.
- Determined that the optional `psrp.sjer.red -> rp.sjer.red` CNAME is not
  necessary for relaxed DMARC alignment because the current envelope sender
  already uses the aligned `rp.sjer.red` subdomain.
- Added `DNS_SPF_INCLUDE=spf.messagingengine.com` to Postal's shared
  environment configuration in
  `packages/homelab/src/cdk8s/src/resources/mail/postal.ts`.
- Verified the focused `@homelab/cdk8s` build, typecheck, lint, and test tasks;
  all 270 active tests passed.
- Verified the synthesized Postal manifest contains the exact SPF override on
  the web, SMTP, and worker containers.
- Published the GitOps change as
  [PR #1844](https://github.com/shepherdjerred/monorepo/pull/1844).

### Remaining

- Monitor PR #1844's Buildkite CI and resolve any failures.
- After merge and deployment, re-run Postal's domain DNS check and confirm the
  SPF status changes from `Invalid` to `OK`.
- Decide separately whether Postal must ingest asynchronous bounce messages.
  The current `rp.sjer.red` MX records send them to Fastmail rather than
  Postal, so Postal's displayed bounce rate may not include remote DSNs.

### Caveats

- Do not add `include:spf.postal.example.com` or replace the Fastmail MX records
  with Postal's `*.example.com` defaults.
- Adding the optional return-path CNAME alone would not route bounces into
  Postal; its target still resolves to the Fastmail MX records.
- Buildkite build #7170 could not start because its pipeline-upload pod is
  unschedulable while the dedicated CI node, Liskov, is
  `NotReady,SchedulingDisabled`. This is an external infrastructure blocker,
  not a failure of the PR head.
