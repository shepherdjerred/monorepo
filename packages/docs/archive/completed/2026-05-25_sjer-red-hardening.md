# sjer.red — hardening (subset of pen-test findings)

## Status

Complete (MTA-STS subset deferred — see [packages/docs/todos/sjer-red-mta-sts.md](packages/docs/todos/sjer-red-mta-sts.md))

## Context

The 2026-05-25 pen test ([packages/docs/logs/2026-05-25_sjer-red-pentest.md](packages/docs/logs/2026-05-25_sjer-red-pentest.md)) surfaced a long list of findings. This plan addresses **five specific ones**:

1. `temporal.sjer.red` runs publicly with `Auth.Enabled: false` (P0).
2. Cloudflare edge accepts TLS 1.0/1.1 across all 9 zones (P1).
3. No HSTS on any subdomain across all 9 zones (P1).
4. `temporal-agent-tasks` bearer-token compare uses `!==` instead of `crypto.timingSafeEqual` (P1).
5. Mail: no CAA, no MTA-STS, no TLSRPT, `sjer.red` DMARC at `p=quarantine` (P2).

**Out of scope for this plan** (intentionally not addressed here):

- The broad "wrap admin services in Cloudflare Access" recommendation — user decision: every other exposed service has its own auth, so adding CF Access in front is redundant. Only Temporal UI gets a fix here, and it gets the "stop exposing it publicly" treatment rather than an Access wrap.
- The two other P0s from the audit: origin IP leak via Minecraft DDNS, and the Birmel OAuth state weakness.
- ChartMuseum `AUTH_ANONYMOUS_GET` flip, P2/P3 items, retiring the archived AWS key, transform-rule security headers.

These can be separate plans if/when the user wants them.

---

## Item 1 — Temporal UI: stop publishing publicly

**Why this works.** The `temporal.sjer.red` Cloudflare Tunnel binding was added in the initial Temporal feature commit ([b0f6ea462](https://github.com/shepherdjerred/monorepo/commit/b0f6ea462)) with no operational requirement — webhooks land at `pr-bot.sjer.red` and `temporal-agent-tasks.sjer.red` (separate bindings in [packages/homelab/src/cdk8s/src/resources/temporal/http-services.ts](packages/homelab/src/cdk8s/src/resources/temporal/http-services.ts)). The UI itself is reachable via the existing TailscaleIngress at `temporal-ui.tailnet-1a49.ts.net`. The 2026-04-21 "expose Temporal gRPC over Tailscale" plan ([packages/docs/plans/2026-04-21_temporal-tailscale-exposure.md:98](packages/docs/plans/2026-04-21_temporal-tailscale-exposure.md:98)) explicitly affirms the "tailnet is the auth boundary" trust model.

**File:** [packages/homelab/src/cdk8s/src/resources/temporal/ui.ts:102-105](packages/homelab/src/cdk8s/src/resources/temporal/ui.ts:102)

**Change:** delete the `createCloudflareTunnelBinding(chart, "temporal-ui-cf-tunnel", { … subdomain: "temporal" })` call. Leave the TailscaleIngress untouched.

**Also delete** the matching DNS record in the Terraform: [packages/homelab/src/tofu/cloudflare/sjer-red.tf](packages/homelab/src/tofu/cloudflare/sjer-red.tf), the `sjer_red_cname_temporal` resource (CNAME `temporal` → cfargotunnel). The Cloudflare operator deletes its own ingress mapping when the TunnelBinding goes; the DNS record is managed by Terraform separately.

**Optional cleanup (not required for the fix):** drop the env var `TEMPORAL_CORS_ORIGINS=…,https://temporal.sjer.red` in [packages/homelab/src/cdk8s/src/resources/temporal/ui.ts:54-56](packages/homelab/src/cdk8s/src/resources/temporal/ui.ts:54) to remove a now-dead allowed origin.

---

## Item 2 — Zone-wide TLS 1.2 minimum + HSTS (all 9 zones)

**Why all 9.** The Cloudflare provider is on v5.19 ([packages/homelab/src/tofu/cloudflare/providers.tf](packages/homelab/src/tofu/cloudflare/providers.tf)). None of the 9 managed zones currently has any settings resource — they all sit on Cloudflare defaults that permit TLS 1.0+ and don't set HSTS. Uniform hardening costs the same as one zone and avoids posture drift.

The 9 zones (one per `*.tf` file under [packages/homelab/src/tofu/cloudflare/](packages/homelab/src/tofu/cloudflare/)): `sjer-red`, `scout-for-lol-com`, `clauderon-com`, `jerredshepherd-com`, `ts-mc-net`, `jerred-is`, `glitter-boys-com`, `better-skill-capped-com`, `discord-plays-pokemon-com`.

**Pattern (apply once per zone):**

In v5 of the Cloudflare provider, edge settings are `cloudflare_zone_setting` (one resource per setting, indexed by `setting_id`). The two we need per zone:

```hcl
resource "cloudflare_zone_setting" "<zone>_min_tls_version" {
  zone_id    = cloudflare_zone.<zone>.id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "<zone>_security_header" {
  zone_id    = cloudflare_zone.<zone>.id
  setting_id = "security_header"
  value = jsonencode({
    strict_transport_security = {
      enabled            = true
      max_age            = 86400          # 1 day — short rollback window
      include_subdomains = true
      preload            = false
      nodelete           = false
    }
  })
}
```

(Verify the exact attribute names against the v5 provider — the `security_header` shape may be a typed object rather than `jsonencode`; if so, switch to a typed block. Look at the generated schema doc for the installed v5.19 provider before writing the final form.)

**Where to put it.** Each zone file already owns its DNS records. Add the two `cloudflare_zone_setting` resources at the bottom of each `*-com.tf` / `*-red.tf` / `*-is.tf` / `*-net.tf` file, immediately after the DNSSEC block. Keep them with the zone they configure rather than centralizing — matches the file-per-zone organization that's already there.

**HSTS rollout staging.** Land with `max_age = 86400` (1 day). After one week of clean production traffic (no plain-HTTP regressions on any subdomain), submit a follow-up PR bumping to `max_age = 31536000`. Preload not in scope.

---

## Item 3 — `temporal-agent-tasks`: timing-safe bearer check

**File:** [packages/temporal/src/event-bridge/agent-task-api.ts:53-57](packages/temporal/src/event-bridge/agent-task-api.ts:53)

**Current:**

```ts
app.post("/agent-tasks", async (c) => {
  if (bearerToken(c.req.header("authorization")) !== token) {
    jsonLog("warning", "Rejected unauthorized agent task request");
    return c.text("unauthorized\n", 401);
  }
```

**Change:** swap the `!==` for `crypto.timingSafeEqual` on equal-length `Buffer`s. Bun supports node's `crypto` natively; no new dep.

```ts
import { timingSafeEqual } from "node:crypto";

// inside the handler:
const presented = bearerToken(c.req.header("authorization")) ?? "";
const a = Buffer.from(presented);
const b = Buffer.from(token);
if (a.length !== b.length || !timingSafeEqual(a, b)) {
  jsonLog("warning", "Rejected unauthorized agent task request");
  return c.text("unauthorized\n", 401);
}
```

The early-return on length mismatch is itself a side channel (token length leaks), but cryptographically tokens are random of fixed length so this is acceptable in practice. If we want to be paranoid we can pad-and-compare, but that's overkill for a hand-rotated bearer.

**Why this style.** Codebase precedent for constant-time compare is the custom XOR loop in [packages/trmnl-dashboard/src/app.ts:72-83](packages/trmnl-dashboard/src/app.ts:72) — that file pre-dates the realization that `crypto.timingSafeEqual` is fine under Bun. Plan: don't propagate the bespoke loop; use the stdlib. (Extracting a shared `timingSafeEqualString` helper is tempting but out of scope — only two sites, and trmnl-dashboard isn't part of this hardening pass.)

**Tests.** [packages/temporal/src/event-bridge/agent-task-api.test.ts:68-110](packages/temporal/src/event-bridge/agent-task-api.test.ts:68) already exercises the unauth (header omitted) and authorized paths. Add one more case: present a wrong-but-same-length token (e.g., `Bearer ${"x".repeat(TOKEN.length)}` against `TOKEN = "test-agent-token"`) and assert 401. This exercises the `timingSafeEqual` byte-compare branch — the existing missing-header test only hits the length-mismatch branch.

---

## Item 4 — Mail hardening

Four sub-changes, scoped to `sjer.red` primarily but two of them (CAA, MTA-STS+TLSRPT) extend to every Fastmail-using zone.

### 4a. `sjer.red`: SPF `~all` → `-all` and DMARC `p=quarantine` → `p=reject`

**Files:** [packages/homelab/src/tofu/cloudflare/sjer-red.tf:644](packages/homelab/src/tofu/cloudflare/sjer-red.tf:644) (SPF) and [packages/homelab/src/tofu/cloudflare/sjer-red.tf:652](packages/homelab/src/tofu/cloudflare/sjer-red.tf:652) (DMARC).

```hcl
# sjer_red_spf
content = "v=spf1 include:spf.messagingengine.com -all"

# sjer_red_dmarc
content = "v=DMARC1; p=reject; rua=mailto:dmarc@sjer.red; ruf=mailto:dmarc@sjer.red; fo=1"
```

Also update [sjer-red.tf:725](packages/homelab/src/tofu/cloudflare/sjer-red.tf:725) (`sjer_red_spf_rp`) to match — `rp` is the Postal return-path subdomain and shares the same trust model.

User has confirmed `dmarc@sjer.red` already exists as a Fastmail alias, so this won't black-hole reports.

The other 8 zones are already at `-all` and `p=reject`; no change there.

### 4b. CAA records (all 9 zones)

Add to **every** zone file (single set of records per zone, all using v5 `cloudflare_dns_record` with `type = "CAA"`):

```hcl
resource "cloudflare_dns_record" "<zone>_caa_issue_letsencrypt" {
  zone_id = cloudflare_zone.<zone>.id
  ttl     = 1
  name    = "<zone-apex>"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "letsencrypt.org"
  }
}

# Same shape for "google.com" and "pki.goog" (Cloudflare uses Google Trust Services for the
# Universal SSL certs it issues on your behalf — without these tags, ACME validation breaks).

resource "cloudflare_dns_record" "<zone>_caa_iodef" {
  # tag = "iodef", value = "mailto:dmarc@sjer.red" (one central iodef contact across all zones)
}

# Block wildcard issuance unless explicitly granted later
resource "cloudflare_dns_record" "<zone>_caa_issuewild_none" {
  # tag = "issuewild", value = ";"
}
```

**Issuers to allow per Cloudflare's published guidance:** `letsencrypt.org`, `pki.goog` (Google Trust Services — Cloudflare's primary Universal SSL issuer today), `comodoca.com` and `digicert.com` if your zone has Advanced Certificate Manager origins. Confirm against `dig CAA google.com` outputs from Cloudflare-edge zones before merging — incorrect CAA can break automatic cert renewal silently. The Cloudflare docs page `https://developers.cloudflare.com/ssl/edge-certificates/caa-records/` lists their current set; trust that over this plan if they diverge.

### 4c. MTA-STS (zones that send Fastmail mail)

Scope: `sjer.red`, `ts-mc.net`, `shepherdjerred.com`. Other Fastmail-using zones (jerredshepherd, jerred.is, scout-for-lol, better-skill-capped, clauderon, discord-plays-pokemon, glitter-boys) get the same treatment since they also use Fastmail MX and benefit equally.

**Step 1 — TXT record per zone:**

```hcl
resource "cloudflare_dns_record" "<zone>_mta_sts" {
  zone_id = cloudflare_zone.<zone>.id
  ttl     = 1
  name    = "_mta-sts"
  type    = "TXT"
  content = "v=STSv1; id=20260525T000000Z"  # rotate id on every policy update
}
```

**Step 2 — Static site hosting the policy.** Reuse the existing pattern from [packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts](packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts). Add one bucket per zone (e.g., `mta-sts-sjer-red`) with a single `.well-known/mta-sts.txt` file:

```
version: STSv1
mode: testing
mx: in1-smtp.messagingengine.com
mx: in2-smtp.messagingengine.com
max_age: 604800
```

`mode: testing` for the first two weeks per user decision — senders report failures but don't refuse delivery. Then submit a follow-up PR flipping to `mode: enforce` and bumping the `id` in the TXT record.

**Step 3 — DNS CNAME** for `mta-sts.<zone>` pointing at the static-site tunnel: `createCloudflareTunnelBinding` is created automatically by the `S3StaticSites` chart at [packages/homelab/src/cdk8s/src/misc/s3-static-site.ts:333-350](packages/homelab/src/cdk8s/src/misc/s3-static-site.ts:333), with `disableDnsUpdates: true` — meaning the corresponding `cloudflare_dns_record` CNAME for `mta-sts.<zone>` must be added explicitly to the Terraform zone file (matching the pattern used by other static sites in the same file).

### 4d. TLSRPT (same zones as MTA-STS)

One TXT record per zone:

```hcl
resource "cloudflare_dns_record" "<zone>_tlsrpt" {
  zone_id = cloudflare_zone.<zone>.id
  ttl     = 1
  name    = "_smtp._tls"
  type    = "TXT"
  content = "v=TLSRPTv1; rua=mailto:tls-reports@sjer.red"
}
```

This requires a `tls-reports@sjer.red` alias in Fastmail (analogous to `dmarc@sjer.red`). **Manual step before merge:** create the alias in Fastmail UI (not managed in IaC today — neither is `dmarc@sjer.red`).

---

## Verification

**Item 1 — Temporal:**

- `dig +short temporal.sjer.red` returns NXDOMAIN after apply.
- `curl -I https://temporal-ui.tailnet-1a49.ts.net/` from a tailnet device still returns 200.
- `curl -I https://pr-bot.sjer.red/healthz` and `curl -I https://temporal-agent-tasks.sjer.red/healthz` (with bearer token) still respond — confirms webhook paths unaffected.

**Item 2 — TLS + HSTS:**

- `openssl s_client -connect <each-zone-apex>:443 -tls1` fails with `wrong version number` or similar handshake error for all 9 zones.
- `openssl s_client -connect <each-zone-apex>:443 -tls1_1` likewise fails.
- `openssl s_client -connect <each-zone-apex>:443 -tls1_2` succeeds.
- `curl -sI https://<each-zone-apex>/ | grep -i strict-transport-security` shows `Strict-Transport-Security: max-age=86400; includeSubDomains` on all 9 zones.

**Item 3 — Timing-safe bearer:**

- New test in `agent-task-api.test.ts` passes (`bun test packages/temporal/src/event-bridge/agent-task-api.test.ts`).
- `bun run typecheck` clean.
- Existing 401-on-missing-header and 202-on-valid-token tests still pass.

**Item 4 — Mail:**

- `dig +short TXT _dmarc.sjer.red` shows `p=reject`.
- `dig +short TXT sjer.red | grep spf` shows `-all`.
- `dig +short CAA <each-zone-apex>` shows allowed issuers + iodef.
- `dig +short TXT _mta-sts.<zone>` shows the STSv1 TXT.
- `curl -sI https://mta-sts.<zone>/.well-known/mta-sts.txt` returns 200 + correct policy.
- `dig +short TXT _smtp._tls.<zone>` shows the TLSRPT record.
- Use `https://www.hardenize.com/report/sjer.red` as an external sanity check — should go from current "F" (no MTA-STS, no CAA) to mostly-green.

---

## Rollout order (recommended PR sequencing)

1. **PR A — code-only, no infra:** Item 3 (timingSafeEqual) + Item 1 (delete CF tunnel binding from `temporal/ui.ts`). One PR, two small commits. Easy to revert independently.
2. **PR B — Terraform DNS-only:** Item 1's DNS-record deletion + Item 4a (SPF/DMARC flip on sjer.red) + Item 4b (CAA for all 9 zones). Pure DNS change, no edge config. Easy to bisect if something complains.
3. **PR C — Terraform edge settings:** Item 2 (TLS min + HSTS for all 9 zones). Edge-only config change; HSTS at 1-day max-age keeps rollback fast.
4. **PR D — cdk8s + Terraform combo:** Item 4c (MTA-STS static sites + CNAMEs + TXT) and Item 4d (TLSRPT TXT). Larger because it spans cdk8s and tofu; depends on Fastmail alias `tls-reports@sjer.red` being created first as a manual prerequisite.
5. **Follow-up PRs (out of scope for this plan):**
   - After 1 week of clean HSTS: bump `max_age` from 86400 → 31536000.
   - After 2 weeks of clean TLSRPT reports: flip MTA-STS `mode: testing` → `mode: enforce` and rotate the `id`.

## Risks & open questions

- **CAA misconfiguration is a foot-gun.** If the allowed issuer list doesn't include whatever Cloudflare's edge cert issuer actually is at the time, automatic renewal of Universal SSL certs silently fails until someone notices. Mitigation: check Cloudflare's current published guidance (`https://developers.cloudflare.com/ssl/edge-certificates/caa-records/`) before merging PR B; include `pki.goog` and `letsencrypt.org` at minimum.
- **TLS 1.2 bump may break ancient clients.** None of the deployed services have known clients on TLS <1.2 (no IoT, no legacy mobile apps). Low risk in this repo.
- **HSTS at 1 day** is conservative — if a subdomain regression serves plain HTTP, browsers stop trusting HTTPS for that subdomain for up to 24 h after the regression is fixed. Acceptable rollback window.
- **MTA-STS `testing` mode** doesn't enforce; the value is purely operational (you'll get TLSRPT reports). The actual posture improvement lands in the follow-up flip to `enforce`.
- **`tls-reports@sjer.red` alias** is a Fastmail UI action, not IaC — easy to forget. Plan calls it out as a prerequisite for PR D.
- **v5 provider attribute names** for `cloudflare_zone_setting` `security_header` may take a typed-object shape rather than `jsonencode` — verify against the locally installed v5.19 provider schema before writing the final HCL.

## Session Log — 2026-05-25

### Done

- **Bundled into a single PR** per user direction (override of the four-PR sequencing in the plan). All five plan items addressed except MTA-STS (4c), which has been deferred to [packages/docs/todos/sjer-red-mta-sts.md](packages/docs/todos/sjer-red-mta-sts.md) because it needs new SeaweedFS buckets, content publication, and per-zone reverse-proxy wiring that doesn't fit a single-PR scope.
- **Item 1 (Temporal UI):** removed `createCloudflareTunnelBinding` and dropped the now-dead `https://temporal.sjer.red` CORS origin from [packages/homelab/src/cdk8s/src/resources/temporal/ui.ts](packages/homelab/src/cdk8s/src/resources/temporal/ui.ts); deleted `sjer_red_cname_temporal` from [packages/homelab/src/tofu/cloudflare/sjer-red.tf](packages/homelab/src/tofu/cloudflare/sjer-red.tf). `cdk8s build` confirms the rendered `temporal.k8s.yaml` no longer contains the FQDN or TunnelBinding; TailscaleIngress for `temporal-ui` still present.
- **Item 2 (TLS+HSTS):** added `cloudflare_zone_setting` resources (`min_tls_version = "1.2"` + `security_header` HSTS at `max_age = 86400`, `include_subdomains`, `nosniff`) to all 10 zone files. Used the typed-object form per the v5.19 provider docs (the plan was uncertain — typed object is the correct shape). `tofu validate` green.
- **Item 3 (timing-safe bearer):** added `bearerMatches()` helper in [packages/temporal/src/event-bridge/agent-task-api.ts](packages/temporal/src/event-bridge/agent-task-api.ts) using `node:crypto.timingSafeEqual`; replaced the `!==` compare in `/agent-tasks`. New test case in [packages/temporal/src/event-bridge/agent-task-api.test.ts](packages/temporal/src/event-bridge/agent-task-api.test.ts) covers the same-length-wrong-token branch; all 4 tests pass. `bun run typecheck` + `bun run lint` clean.
- **Item 4a (DMARC/SPF on sjer.red):** SPF `~all` → `-all` on both `sjer.red` and `rp.sjer.red`; DMARC `p=quarantine` → `p=reject` with added `ruf` + `fo=1` for forensic reports.
- **Item 4b (CAA, all 10 zones):** authorized issuers Cloudflare uses to provision certs — `letsencrypt.org`, `pki.goog; cansignhttpexchanges=yes`, `sectigo.com`, `ssl.com` — plus `issuewild ";"` (block wildcard issuance) and `iodef → mailto:dmarc@sjer.red`. Generated via `/tmp/add-zone-hardening.ts` to keep all 10 zones consistent.
- **Item 4d (TLSRPT):** TXT records added for the 3 mail-receiving zones (`sjer.red`, `shepherdjerred.com`, `ts-mc.net`). Routed to `dmarc@sjer.red` (the existing Fastmail alias) — no separate `tls-reports@` mailbox needed.
- **Codebase precedent retained:** the custom XOR-loop `timingSafeEqual` in [packages/trmnl-dashboard/src/app.ts:72-83](packages/trmnl-dashboard/src/app.ts:72) was intentionally left alone (out of scope; only two sites total).

### Remaining

- **MTA-STS (Item 4c)** deferred to [packages/docs/todos/sjer-red-mta-sts.md](packages/docs/todos/sjer-red-mta-sts.md). The deferred work: add per-zone `mta-sts.<zone>` static sites to [packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts](packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts), publish the `.well-known/mta-sts.txt` policy to the corresponding SeaweedFS buckets, add `_mta-sts.<zone>` TXT records, add `mta-sts.<zone>` CNAMEs.
- **HSTS ramp:** after 1 week of clean traffic, follow-up PR should bump `max_age` from 86400 → 31536000.
- The other P0 findings from the audit (origin-IP leak via Minecraft DDNS; Birmel OAuth state weakness) and the P3 transform-rule security headers are still outstanding — each will need its own plan.

### Caveats

- **CAA is a foot-gun.** I authorized the full set of CAs Cloudflare may use per their published guidance, but if Cloudflare adds a new edge-cert issuer in the future and someone forgets to add it to CAA, automatic renewal will silently break. Mitigation: re-check the published list whenever Cloudflare announces new SSL providers, and set up an alert on Cloudflare's "edge certificate not renewed" notification.
- **tofu fmt -recursive** also reformatted `backend.tf` and `.terraform.lock.hcl`; both were reverted to keep the PR scoped to intentional changes only.
- **HSTS at 1-day** means any subdomain that accidentally regresses to plain HTTP will be unreachable from browsers that saw the header for up to 24h after the regression is fixed. Acceptable rollback window per user-approved plan.
- **DMARC `p=reject`** depends on the `dmarc@sjer.red` Fastmail alias actually being read — user confirmed it exists. If it bounces, aggregate reports go to /dev/null and the policy still enforces (just no visibility).
- **No `tofu plan` ran** — backend is SeaweedFS, requires `op run` for credentials. The plan diff should be reviewed in CI/operator session before apply.
