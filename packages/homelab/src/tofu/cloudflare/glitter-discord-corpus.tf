# Off-site mirror for the loss-intolerant Glitter Discord corpus. R2 S3
# credentials are minted manually with Object Read & Write access scoped to
# this bucket and stored in the Temporal worker's 1Password item.
resource "cloudflare_r2_bucket" "glitter_discord_corpus" {
  account_id = var.cloudflare_account_id
  name       = "glitter-discord-corpus"
  location   = "WNAM"

  lifecycle {
    prevent_destroy = true
  }
}
