resource "github_repository" "monorepo" {
  name                        = "monorepo"
  description                 = "Monorepo for all of my projects"
  visibility                  = "public"
  has_issues                  = true
  has_projects                = false
  has_wiki                    = false
  delete_branch_on_merge      = true
  allow_auto_merge            = true
  allow_update_branch         = true
  allow_squash_merge          = true
  allow_merge_commit          = false
  allow_rebase_merge          = false
  squash_merge_commit_title   = "PR_TITLE"
  squash_merge_commit_message = "COMMIT_MESSAGES"
}

# Branch protection is managed via github_repository_ruleset in rulesets.tf.
# The old github_branch_protection resource used GraphQL and hung on refresh;
# github_repository_ruleset uses the REST API instead.

resource "github_repository" "shepherdjerred" {
  name                   = "shepherdjerred"
  description            = "My profile README"
  visibility             = "public"
  has_issues             = true
  has_projects           = false
  has_wiki               = false
  delete_branch_on_merge = true
  allow_auto_merge       = true
  allow_update_branch    = true
  allow_squash_merge     = false
  allow_merge_commit     = true
  allow_rebase_merge     = true
}
