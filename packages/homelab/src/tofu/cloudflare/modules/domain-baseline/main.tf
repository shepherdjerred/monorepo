terraform {
  required_version = ">= 1.6.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.25.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.5"
    }
  }
}

variable "zone_id" {
  type        = string
  description = "Existing Cloudflare zone; this module never creates or replaces zones."
}

variable "domain" {
  type        = string
  description = "Apex domain served by Fastmail."
  validation {
    condition     = can(regex("^[a-z0-9-]+(\\.[a-z0-9-]+)+$", var.domain))
    error_message = "domain must be a lowercase DNS name."
  }
}

variable "wildcard_mail" {
  type        = bool
  description = "Preserve Fastmail subdomain addressing. This does not authenticate arbitrary subdomain senders."
}

variable "fastmail_ready" {
  type        = bool
  description = "Account-side domain onboarding is confirmed; permit MX cutover and outbound SPF only when ready."
}

variable "tls_1_3" {
  type        = string
  description = "TLS 1.3 setting; preserve existing zrt without enabling new 0-RTT."
  validation {
    condition     = contains(["on", "zrt"], var.tls_1_3)
    error_message = "TLS 1.3 must remain enabled."
  }
}

variable "mta_sts_published" {
  type        = bool
  description = "Publish discovery only after HTTPS policy and SMTP STARTTLS acceptance checks."
}

variable "ct_alert_recipient" {
  type        = string
  default     = "root@sjer.red"
  description = "Owned inbox for certificate alerts. Explicit null preserves existing Cloudflare recipients."
  validation {
    condition     = var.ct_alert_recipient == null || can(regex("^[^ @,]+@[^ @,]+\\.[^ @,]+$", var.ct_alert_recipient))
    error_message = "Use a single email address, or null to preserve existing recipients."
  }
}

variable "mail_policy" {
  type = object({
    version = string
    mode    = string
    mx      = list(string)
    maxAge  = number
  })
  description = "Language-neutral MTA-STS policy shared with Caddy."
  validation {
    condition = (
      var.mail_policy.version == "STSv1" && var.mail_policy.mode == "enforce" &&
      var.mail_policy.maxAge == 86400 &&
      var.mail_policy.mx == tolist(["in1-smtp.messagingengine.com", "in2-smtp.messagingengine.com"])
    )
    error_message = "The policy must enforce Fastmail's two MX hosts with a one-day cache."
  }
}

locals {
  mx = {
    primary   = { host = var.mail_policy.mx[0], priority = 10 }
    secondary = { host = var.mail_policy.mx[1], priority = 20 }
  }
  certificate_authorities = {
    letsencrypt           = "letsencrypt.org"
    google_trust_services = "pki.goog; cansignhttpexchanges=yes"
    sectigo               = "sectigo.com"
    ssl_com               = "ssl.com"
  }
  policy_text = join("\n", concat(
    ["version: ${var.mail_policy.version}", "mode: ${var.mail_policy.mode}"],
    [for mx in var.mail_policy.mx : "mx: ${mx}"],
    ["max_age: ${var.mail_policy.maxAge}", ""]
  ))
}

resource "cloudflare_zone_dnssec" "dnssec" {
  zone_id = var.zone_id
  status  = "active"
}

resource "cloudflare_dns_record" "mx" {
  for_each = var.fastmail_ready ? local.mx : {}
  zone_id  = var.zone_id
  ttl      = 1
  name     = var.domain
  type     = "MX"
  content  = each.value.host
  priority = each.value.priority
}

resource "cloudflare_dns_record" "wildcard_mx" {
  for_each = var.fastmail_ready && var.wildcard_mail ? local.mx : {}
  zone_id  = var.zone_id
  ttl      = 1
  name     = "*"
  type     = "MX"
  content  = each.value.host
  priority = each.value.priority
}

resource "cloudflare_dns_record" "dkim" {
  for_each = toset(["fm1", "fm2", "fm3"])
  zone_id  = var.zone_id
  ttl      = 1
  name     = "${each.key}._domainkey"
  type     = "CNAME"
  content  = "${each.key}.${var.domain}.dkim.fmhosted.com"
  proxied  = false
}

resource "cloudflare_dns_record" "spf" {
  zone_id = var.zone_id
  ttl     = 1
  name    = var.domain
  type    = "TXT"
  content = var.fastmail_ready ? "v=spf1 include:spf.messagingengine.com -all" : "v=spf1 -all"
}

resource "cloudflare_dns_record" "dmarc" {
  zone_id = var.zone_id
  ttl     = 1
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; sp=reject; adkim=r; aspf=r; rua=mailto:dmarc@sjer.red"
}

resource "cloudflare_dns_record" "tlsrpt" {
  zone_id = var.zone_id
  ttl     = 1
  name    = "_smtp._tls"
  type    = "TXT"
  content = "v=TLSRPTv1; rua=mailto:dmarc@sjer.red"
}

resource "cloudflare_dns_record" "mta_sts_host" {
  zone_id = var.zone_id
  ttl     = 1
  name    = "mta-sts"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# The revision is derived from the exact served policy, including its final LF.
data "http" "mail_policy" {
  count              = var.mta_sts_published ? 1 : 0
  url                = "https://mta-sts.${var.domain}/.well-known/mta-sts.txt"
  request_timeout_ms = 10000
}

resource "cloudflare_dns_record" "mta_sts" {
  count   = var.mta_sts_published ? 1 : 0
  zone_id = var.zone_id
  ttl     = 1
  name    = "_mta-sts"
  type    = "TXT"
  content = "v=STSv1; id=${substr(sha256(local.policy_text), 0, 16)}"
  lifecycle {
    precondition {
      condition     = var.fastmail_ready
      error_message = "Confirm the domain in Fastmail before advertising transport enforcement."
    }
    precondition {
      condition = (
        data.http.mail_policy[0].status_code == 200 &&
        data.http.mail_policy[0].response_body == local.policy_text &&
        startswith(lookup(data.http.mail_policy[0].response_headers, "Content-Type", ""), "text/plain")
      )
      error_message = "Serve the exact HTTPS Fastmail policy as plain text before publishing MTA-STS discovery."
    }
  }
}

resource "cloudflare_dns_record" "caa_issue" {
  for_each = local.certificate_authorities
  zone_id  = var.zone_id
  ttl      = 1
  name     = var.domain
  type     = "CAA"
  data     = { flags = 0, tag = "issue", value = each.value }
}

# Cloudflare Universal SSL uses wildcard certificates for Tunnel hostnames.
resource "cloudflare_dns_record" "caa_issuewild" {
  for_each = local.certificate_authorities
  zone_id  = var.zone_id
  ttl      = 1
  name     = var.domain
  type     = "CAA"
  data     = { flags = 0, tag = "issuewild", value = each.value }
}

resource "cloudflare_dns_record" "caa_iodef" {
  zone_id = var.zone_id
  ttl     = 1
  name    = var.domain
  type    = "CAA"
  data    = { flags = 0, tag = "iodef", value = "mailto:dmarc@sjer.red" }
}

resource "cloudflare_zone_setting" "https" {
  zone_id    = var.zone_id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "ssl" {
  zone_id    = var.zone_id
  setting_id = "ssl"
  value      = "strict"
}

resource "cloudflare_zone_setting" "min_tls_version" {
  zone_id    = var.zone_id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "tls_1_3" {
  zone_id    = var.zone_id
  setting_id = "tls_1_3"
  value      = var.tls_1_3
}

resource "cloudflare_zone_setting" "security_header" {
  zone_id    = var.zone_id
  setting_id = "security_header"
  value = {
    strict_transport_security = {
      enabled            = true
      max_age            = 86400
      include_subdomains = true
      nosniff            = true
      preload            = false
    }
  }
}

resource "cloudflare_ct_alerting" "ct" {
  count   = var.ct_alert_recipient == null ? 0 : 1
  zone_id = var.zone_id
  enabled = true
  emails  = [var.ct_alert_recipient]
}

resource "cloudflare_ct_alerting" "ct_existing" {
  count   = var.ct_alert_recipient == null ? 1 : 0
  zone_id = var.zone_id
  enabled = true
  # Retain previously configured recipients without exposing their addresses in source.
  lifecycle {
    ignore_changes = [emails]
  }
}
