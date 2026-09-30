resource "cloudflare_zone" "clauderon_com" {
  account = { id = var.cloudflare_account_id }
  name    = "clauderon.com"
}

# Preserve the existing record's state identity while changing its type. This
# makes the CNAME-to-AAAA transition an ordered update rather than an
# unrelated destroy/create pair.
moved {
  from = cloudflare_dns_record.clauderon_com_cname_apex
  to   = cloudflare_dns_record.clauderon_com_apex
}

# The archived site is retired. Cloudflare's edge serves the redirect before
# any origin fetch, so the discard address is never actually contacted.
resource "cloudflare_dns_record" "clauderon_com_apex" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "clauderon.com"
  type    = "AAAA"
  content = "100::"
  proxied = true

  # Activate the edge redirect before replacing the working tunnel origin.
  depends_on = [cloudflare_ruleset.clauderon_com_redirect]
}

resource "cloudflare_dns_record" "clauderon_com_www" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "www"
  type    = "AAAA"
  content = "100::"
  proxied = true

  depends_on = [cloudflare_ruleset.clauderon_com_redirect]
}

# Proxied IPv4 placeholders ensure IPv4-only clients can reach Cloudflare's
# edge and receive the redirect; the address is never contacted as an origin.
resource "cloudflare_dns_record" "clauderon_com_apex_ipv4" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "clauderon.com"
  type    = "A"
  content = "192.0.2.1"
  proxied = true

  # Cloudflare rejects A/AAAA records while the old apex CNAME still exists.
  depends_on = [
    cloudflare_dns_record.clauderon_com_apex,
    cloudflare_ruleset.clauderon_com_redirect,
  ]
}

resource "cloudflare_dns_record" "clauderon_com_www_ipv4" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "www"
  type    = "A"
  content = "192.0.2.1"
  proxied = true

  depends_on = [cloudflare_ruleset.clauderon_com_redirect]
}

resource "cloudflare_ruleset" "clauderon_com_redirect" {
  zone_id = cloudflare_zone.clauderon_com.id
  name    = "clauderon.com to sjer.red"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [{
    ref         = "clauderon_to_sjer_red"
    description = "Redirect the retired Clauderon site to sjer.red"
    expression  = "(http.host eq \"clauderon.com\" or http.host eq \"www.clauderon.com\")"
    action      = "redirect"
    action_parameters = {
      from_value = {
        status_code           = 301
        preserve_query_string = true
        target_url = {
          expression = "concat(\"https://sjer.red\", http.request.uri.path)"
        }
      }
    }
  }]
}
