resource "cloudflare_zone" "jerred_is" {
  account = { id = var.cloudflare_account_id }
  name       = "jerred.is"
}

# Redirect to sjer.red
resource "cloudflare_dns_record" "jerred_is_cname_apex" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "jerred.is"
  type    = "CNAME"
  content = "sjer.red"
  proxied = true
}

resource "cloudflare_dns_record" "jerred_is_cname_www" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "www"
  type    = "CNAME"
  content = "sjer.red"
  proxied = true
}

# Email security
resource "cloudflare_dns_record" "jerred_is_spf" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "jerred.is"
  type    = "TXT"
  content = "v=spf1 -all"
}

resource "cloudflare_dns_record" "jerred_is_dmarc" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=mailto:dmarc@sjer.red"
}

resource "cloudflare_dns_record" "jerred_is_dkim_wildcard" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "*._domainkey"
  type    = "TXT"
  content = "v=DKIM1; p="
}

# DNSSEC (pending — .is TLD requires manual DS record at registrar)
resource "cloudflare_zone_dnssec" "jerred_is" {
  zone_id = cloudflare_zone.jerred_is.id
}
