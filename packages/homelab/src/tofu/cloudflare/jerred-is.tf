resource "cloudflare_zone" "jerred_is" {
  account_id = var.cloudflare_account_id
  zone       = "jerred.is"
}

# Redirect to sjer.red
resource "cloudflare_record" "jerred_is_cname_apex" {
  zone_id = cloudflare_zone.jerred_is.id
  name    = "jerred.is"
  type    = "CNAME"
  content = "sjer.red"
  proxied = true
}

resource "cloudflare_record" "jerred_is_cname_www" {
  zone_id = cloudflare_zone.jerred_is.id
  name    = "www"
  type    = "CNAME"
  content = "sjer.red"
  proxied = true
}

# Email security
resource "cloudflare_record" "jerred_is_spf" {
  zone_id = cloudflare_zone.jerred_is.id
  name    = "jerred.is"
  type    = "TXT"
  content = "v=spf1 -all"
}

resource "cloudflare_record" "jerred_is_dmarc" {
  zone_id = cloudflare_zone.jerred_is.id
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;"
}

resource "cloudflare_record" "jerred_is_dkim_wildcard" {
  zone_id = cloudflare_zone.jerred_is.id
  name    = "*._domainkey"
  type    = "TXT"
  content = "v=DKIM1; p="
}

# DNSSEC (pending — .is TLD requires manual DS record at registrar)
resource "cloudflare_zone_dnssec" "jerred_is" {
  zone_id = cloudflare_zone.jerred_is.id
}
