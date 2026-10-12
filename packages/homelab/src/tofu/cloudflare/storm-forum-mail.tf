# Postal's public ownership challenge and DKIM key for forum@ts-mc.net.
# The domain already publishes Fastmail SPF, matching Postal's relay provider.
resource "cloudflare_dns_record" "storm_forum_postal_verification" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "ts-mc.net"
  type    = "TXT"
  content = "postal-verification HKCOMItuyiZSPNzqI7kWzJ1JIpBZobWX"
}

resource "cloudflare_dns_record" "storm_forum_postal_dkim" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "postal-pucwal._domainkey"
  type    = "TXT"
  content = "v=DKIM1; t=s; h=sha256; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDP3gYfobFff0FOxghUPTZ+k6J8IUhHcRa2PKQEFA+/zEo0Qeon8v5F0rjPXUdqenBEPgA/F/NPx8D6pZuVB8YAbUmFLCTfzrInT7M4jpOKLgV1bo2V0quSXuxs1vydu/UFmmRezH35GFt9aXcsUqWu+YlUVz9KLbfIv/P0aSCYmQIDAQAB;"
}

resource "cloudflare_dns_record" "storm_forum_postal_return_path" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "psrp"
  type    = "CNAME"
  content = "rp.sjer.red"
  proxied = false
}
