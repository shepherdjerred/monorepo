# Dotfiles Audit

## Status

Complete

Audited chezmoi source, managed targets, unmanaged live files, source Git state, secret-template handling, and Homebrew bundle state without changing machine configuration.

## Deep Audit Addendum

- Six tracked agent skills incorrectly state that Buildkite CI was removed, despite the active 692-line `.buildkite/pipeline.yml`: `buildkite-helper`, `pr-health`, `pr-monitor`, `pr-workflow-automation`, `torvalds-deployment`, and `xcode-cloud-debug`.
- `dot_agents/skills/apple-hig-helper/README.md` and `scrape.sh` reference removed paths and a lowercase `skill.md`; the actual source is `SKILL.md` and no referenced `/workspace/scripts/scrape-apple-hig.py` exists.
- `~/.config/linearmouse/linearmouse.json`, `~/.config/lvim/config.lua`, `~/.config/zed/settings.json`, and `~/.config/bk.yaml` contain durable, non-secret preferences that are not managed by chezmoi. Zed prompt and theme directories are runtime databases and should remain unmanaged.
- `.Brewfile_darwin` still declares `gemini-cli` and `git-credential-manager` even though Gemini was removed and the active Git configuration no longer uses GCM.
- The live `~/.bazelrc` and `.cdk8s-cli.version` are unmanaged tool state. They are candidates for deletion only if no external projects require them.
- `create_` files are intentionally write-once bootstrap sources. Their contents will not update an existing target, so they require explicit ownership documentation or periodic refresh.

## Session Log — 2026-07-19

### Done

- Ran `chezmoi doctor`, `status`, `diff`, `verify`, `managed`, and `unmanaged` against `packages/dotfiles` and the live home directory.
- Identified six managed target drifts: `.agents/skills/buildkite-helper/SKILL.md`, `.agents/skills/version-management/SKILL.md`, `.claude/settings.json`, `.config/mise/config.toml`, `.config/opencode/opencode.jsonc`, and `.gitconfig`; `sync-theme.sh` is the expected always-run script diff.
- Confirmed tracked credential-bearing configuration is rendered from 1Password templates rather than storing credential material in the source tree.
- Identified untracked durable configuration candidates and stale live files, including Claude/Talos backups and Codex's 2.0 GB log database.
- Measured `dot_agents` at 4.33 MB of the 4.53 MB dotfiles source, making it the only material source-tree bulk candidate.
- Ran a non-mutating Homebrew bundle audit: `linearmouse`, `orion`, and `gemini-cli` are unmet; cleanup would remove unlisted applications, discontinued tooling, and caches.
- Extended the audit with source-to-live coverage, stale agent documentation, and unmanaged durable configuration classification.

### Remaining

- Decide which managed target changes to capture with `chezmoi re-add` and commit the active source changes, including the untracked `private_dot_codex/` rules.
- Review Homebrew cleanup candidates before any removal because the output includes applications and transitive formulae.
- Delete or archive the confirmed stale backups and choose a retention approach for Codex logs.
- Correct or remove stale agent CI and Apple HIG refresh guidance before relying on the deployed skill corpus.
- Add the selected durable live preferences to chezmoi with the appropriate private-file attributes.

### Caveats

- `gitleaks` reports 20 documentation-example false positives under `dot_agents`; it did not report rendered credentials from the source templates.
- `.config/chezmoi/chezmoi.toml` is intentionally unmanaged bootstrap state because it selects the chezmoi source directory.
- `~/.codex/config.toml` was intentionally untracked in May; only its new `rules/safety.rules` source directory is pending Git addition.
