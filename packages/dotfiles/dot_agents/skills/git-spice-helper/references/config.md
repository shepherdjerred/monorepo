# git-spice config (`spice.*` git-config keys)

Set with `git config [--global|--local] spice.<key> <value>`. Keys are
case-sensitive subsections, e.g. `spice.branchCreate.commit` →
`[spice "branchCreate"]  commit = …`.

## Set in this repo's dotfiles

| Key | Value | Why |
| --- | --- | --- |
| `spice.branchCreate.commit` | `false` | `git-spice branch create <name>` makes **no** commit (name required). Prevents git-spice's default empty/placeholder commit from being rejected by the `commit-msg` hook (`scripts/validate-commit-msg.ts`). Committed in `private_dot_gitconfig.tmpl`. |

The stacking-friendly git settings git-spice relies on are already present in
`private_dot_gitconfig.tmpl` and need no change: `rebase.updateRefs = true`,
`push.autoSetupRemote = true`, `pull.rebase = true`.

## Worth knowing (set per-need, not committed)

| Key | Default | Use |
| --- | --- | --- |
| `spice.submit.skipRestackCheck` | `never` | `trunk` or `always` — submit without git-spice refusing "branch not restacked". Handy for a fast-moving monorepo trunk; logs a warning instead. |
| `spice.submit.draft` | `false` | Open PRs as drafts by default. |
| `spice.submit.publish` | `true` | `false` = push branches but don't open PRs. |
| `spice.submit.navigationComment` | `true` | `false` to suppress the stack navigation comment, `multiple` for multi-comment mode. |
| `spice.submit.reviewers` | — | Comma list of default reviewers (`user` or `org/team`). |
| `spice.submit.labels` | — | Comma list of default labels. |
| `spice.branchCreate.prefix` | — | Prepend a prefix (e.g. `user/`) to generated branch names. |
| `spice.repoSync.restack` | `none` | `upstack`/`aboves` to rebase survivors on every `repo sync`. |
| `spice.git.indexLockTimeout` | `5s` | Retry window on `index.lock` contention (background git racing). |
| `spice.secret.backend` | `auto` | `keyring`/`file` — override token storage backend. |

## Auth / forge (only if defaults don't fit)

- `spice.forge.kind` — force `github` when an SSH remote alias hides the host.
- Env vars: `GITHUB_TOKEN` (CI only — overrides everything and disables
  `git-spice auth login`), `GIT_SPICE_SECRET_BACKEND`, `GIT_SPICE_FORGE_KIND`.

## Custom shorthands (optional)

```bash
# built-ins are listed in command-reference.md; add your own:
git config --global spice.shorthand.can "commit amend --no-edit"
# shell shorthand (prefix with !):
git config --global spice.shorthand.wip '!git-spice commit create -m "wip"'
```

Full list: <https://abhinav.github.io/git-spice/cli/config/>
