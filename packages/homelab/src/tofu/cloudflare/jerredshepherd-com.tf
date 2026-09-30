resource "cloudflare_zone" "jerredshepherd_com" {
  account = { id = var.cloudflare_account_id }
  name    = "jerredshepherd.com"
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
