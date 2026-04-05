resource "cloudflare_zone" "glitter_boys_com" {
  account = { id = var.cloudflare_account_id }
  name       = "glitter-boys.com"
}

# Fly.io app CNAMEs
resource "cloudflare_dns_record" "glitter_boys_com_cname_beta" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "beta"
  type    = "CNAME"
  content = "glitter-boys-beta.fly.dev"
  proxied = false
}

resource "cloudflare_dns_record" "glitter_boys_com_cname_prod" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "prod"
  type    = "CNAME"
  content = "glitter-boys-prod.fly.dev"
  proxied = false
}

# Email security
resource "cloudflare_dns_record" "glitter_boys_com_spf" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "glitter-boys.com"
  type    = "TXT"
  content = "v=spf1 -all"
}

resource "cloudflare_dns_record" "glitter_boys_com_dmarc" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=mailto:dmarc@sjer.red"
}

resource "cloudflare_dns_record" "glitter_boys_com_dkim_wildcard" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "*._domainkey"
  type    = "TXT"
  content = "v=DKIM1; p="
}

# DNSSEC
resource "cloudflare_zone_dnssec" "glitter_boys_com" {
  zone_id = cloudflare_zone.glitter_boys_com.id
}
