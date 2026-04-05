resource "cloudflare_zone" "jerredshepherd_com" {
  account = { id = var.cloudflare_account_id }
  name       = "jerredshepherd.com"
}

# Redirect to sjer.red
resource "cloudflare_dns_record" "jerredshepherd_com_cname_apex" {
  zone_id = cloudflare_zone.jerredshepherd_com.id
  ttl     = 1
  name    = "jerredshepherd.com"
  type    = "CNAME"
  content = "sjer.red"
  proxied = false
}

resource "cloudflare_dns_record" "jerredshepherd_com_cname_www" {
  zone_id = cloudflare_zone.jerredshepherd_com.id
  ttl     = 1
  name    = "www"
  type    = "CNAME"
  content = "sjer.red"
  proxied = false
}

# Email security
resource "cloudflare_dns_record" "jerredshepherd_com_spf" {
  zone_id = cloudflare_zone.jerredshepherd_com.id
  ttl     = 1
  name    = "jerredshepherd.com"
  type    = "TXT"
  content = "v=spf1 -all"
}

resource "cloudflare_dns_record" "jerredshepherd_com_dmarc" {
  zone_id = cloudflare_zone.jerredshepherd_com.id
  ttl     = 1
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=mailto:dmarc@sjer.red"
}

resource "cloudflare_dns_record" "jerredshepherd_com_dkim_wildcard" {
  zone_id = cloudflare_zone.jerredshepherd_com.id
  ttl     = 1
  name    = "*._domainkey"
  type    = "TXT"
  content = "v=DKIM1; p="
}

# DNSSEC
resource "cloudflare_zone_dnssec" "jerredshepherd_com" {
  zone_id = cloudflare_zone.jerredshepherd_com.id
}
