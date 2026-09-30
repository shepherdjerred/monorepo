# Authorize aggregate reports to dmarc@sjer.red from every managed external domain.
resource "cloudflare_dns_record" "dmarc_report" {
  for_each = { for domain, config in local.domain_registry.domains : domain => config if domain != "sjer.red" }
  zone_id  = cloudflare_zone.sjer_red.id
  ttl      = 1
  name     = "${each.key}._report._dmarc"
  type     = "TXT"
  content  = "v=DMARC1"
}
