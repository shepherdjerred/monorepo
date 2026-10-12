# The legacy list includes all subdomains of the two personal .com domains.
# Keep its website redirects while letting their dedicated mail-policy hosts
# reach the Cloudflare Tunnel. List contents remain unchanged during adoption.
resource "cloudflare_ruleset" "bulk_redirects" {
  account_id  = var.cloudflare_account_id
  name        = "default"
  description = ""
  kind        = "root"
  phase       = "http_request_redirect"

  rules = [
    {
      ref         = "fe1c9ab9b8c748b48f5903b135f23507"
      description = "sjerred"
      enabled     = true
      expression  = "(http.request.full_uri in $sjerred) and not (http.host in {\"mta-sts.jerredshepherd.com\" \"mta-sts.shepherdjerred.com\"})"
      action      = "redirect"
      action_parameters = {
        from_list = {
          key  = "http.request.full_uri"
          name = "sjerred"
        }
      }
    },
    {
      ref         = "100da224266e402bb21da80d01c5d179"
      description = "resume"
      enabled     = false
      expression  = "http.request.full_uri in $resume"
      action      = "redirect"
      action_parameters = {
        from_list = {
          key  = "http.request.full_uri"
          name = "resume"
        }
      }
    }
  ]

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = cloudflare_ruleset.bulk_redirects
  id = "accounts/48948ed6cd40d73e34d27f0cc10e595f/ea1ab5d0737441118d227236662533ac"
}
