resource "github_repository" "anki" {
  name                   = "anki"
  description            = "My Anki cards"
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

resource "github_repository" "astro_opengraph_images" {
  name                   = "astro-opengraph-images"
  description            = "Generate Open Graph images for your Astro site"
  homepage_url           = "https://www.npmjs.com/package/astro-opengraph-images"
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

resource "github_repository" "better_skill_capped" {
  name                   = "better-skill-capped"
  description            = "A better interface for Skill Capped"
  homepage_url           = "https://better-skill-capped.com/"
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

resource "github_repository" "castle_casters" {
  name                   = "castle-casters"
  description            = "A game I wrote from scratch"
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

resource "github_repository" "dagger" {
  name                   = "dagger"
  description            = "An open-source runtime for composable workflows. Great for AI agents and CI/CD."
  homepage_url           = "https://dagger.io"
  visibility             = "public"
  has_issues             = false
  has_projects           = false
  has_wiki               = false
  delete_branch_on_merge = true
  allow_squash_merge     = false
  allow_merge_commit     = true
  allow_rebase_merge     = true
}

resource "github_repository" "discord_plays_pokemon" {
  name                   = "discord-plays-pokemon"
  description            = "Twitch Plays Pokémon, but for Discord"
  homepage_url           = "https://docs.discord-plays-pokemon.com/"
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

resource "github_repository" "dotfiles" {
  name                   = "dotfiles"
  description            = "My personal dotfiles"
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

resource "github_repository" "homelab" {
  name                   = "homelab"
  description            = "Configuration-as-code for my homelab"
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

resource "github_repository" "macos_cross_compiler" {
  name                   = "macos-cross-compiler"
  description            = "Compile binaries for macOS on Linux"
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

resource "github_repository" "monorepo" {
  name                   = "monorepo"
  description            = "Old repositories & practice projects"
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

resource "github_repository" "resume" {
  name                   = "resume"
  description            = "My résumé"
  homepage_url           = "https://resume.sjer.red"
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

resource "github_repository" "scout_for_lol" {
  name                   = "scout-for-lol"
  description            = "Create match reports for League of Legends"
  homepage_url           = "http://scout-for-lol.com"
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

resource "github_repository" "sjer_red" {
  name                   = "sjer.red"
  description            = "My personal website"
  homepage_url           = "https://sjer.red"
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

resource "github_repository" "starlight_karma_bot" {
  name                   = "starlight-karma-bot"
  description            = "Karma bot for my personal Discord server :^)"
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

resource "github_repository" "webring" {
  name                   = "webring"
  description            = "Collect the latest RSS items from your favorite feeds"
  homepage_url           = "https://www.npmjs.com/package/webring"
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
