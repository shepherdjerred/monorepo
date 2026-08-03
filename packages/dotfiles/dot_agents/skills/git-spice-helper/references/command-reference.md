# git-spice command reference

Canonical binary: **`git-spice`**. The `gs …` column is the interactive fish
abbreviation — it does **not** work in scripts/CI/agent Bash (there `gs` =
Ghostscript), so use `git-spice` in those contexts. Shorthand form is
`git-spice branch create` → `gs bc` (concatenate the parenthesized aliases).

Global flags on every command: `-h/--help`, `--version`, `-v/--verbose`,
`-C/--dir=DIR`, `--[no-]prompt` (use `--no-prompt` in scripts).

## Repository

| Command | Shorthand | Does |
| --- | --- | --- |
| `git-spice repo init` | `gs ri` | Set up the store; pick trunk/remotes. Flags: `--trunk`, `--remote`, `--upstream`, `--reset`. Auto-runs when needed. |
| `git-spice repo sync` | `gs rs` | Pull trunk, delete merged branches, retarget survivors. `--restack[=none\|aboves\|upstack]` to also rebase them. |
| `git-spice repo restack` | `gs rr` | Rebase **all** tracked branches onto their bases. |

## Log

| Command | Shorthand | Does |
| --- | --- | --- |
| `git-spice log short` | `gs ls` | Branches in the current stack. `-a/--all`, `--json`, `-S/--cr-status`. |
| `git-spice log long` | `gs ll` | As above + commits per branch. |

## Navigation (all take `-n/--dry-run`, `--detach`)

| Command | Shorthand | Does |
| --- | --- | --- |
| `git-spice up [n]` | `gs u` | Check out the branch n above (prompts if multiple). |
| `git-spice down [n]` | `gs d` | Check out the branch below (trunk at the bottom). |
| `git-spice top` | `gs U` | Topmost branch in the stack. |
| `git-spice bottom` | `gs D` | Bottommost branch (just above trunk). |
| `git-spice trunk` | — | Check out trunk (`main`). |
| `git-spice branch checkout [name]` | `gs bco` | Switch to a branch (fuzzy tree prompt if no arg). `-u/--untracked`. |

## Branch management

| Command | Shorthand | Does |
| --- | --- | --- |
| `git-spice branch create [name]` | `gs bc` | New branch stacked on current. With `spice.branchCreate.commit=false` (this repo) makes **no** commit and **requires a name**. Flags: `-a/--all`, `--no-commit`/`--commit`, `-m/--message`, `-F/--message-file`, `--insert`, `--below`, `-t/--target`, `--[no-]restack`, `--no-verify`, `--signoff`. |
| `git-spice branch submit` | `gs bs` | Create/update the PR for the current branch. `--title`, `--body`, + submit flags below. |
| `git-spice branch restack` | `gs br` | Rebase the current branch onto its base. `--branch=NAME`. |
| `git-spice branch onto [onto]` | `gs bon` | Move **only** the current branch onto a new base (upstack retargets to the old base). |
| `git-spice branch track [name]` | `gs btr` | Start tracking an existing branch; `-b/--base`. |
| `git-spice branch untrack [name]` | `gs buntr` | Stop tracking (keeps the git branch). |
| `git-spice branch delete [names…]` | `gs bd` (`rm`) | Delete branch(es) + remove from stack. `--force`, `--restack`. |
| `git-spice branch rename [old] [new]` | `gs brn` (`mv`) | Rename a branch. |
| `git-spice branch fold` | `gs bfo` | Merge the branch's commits into its base, delete it, reparent upstack. |
| `git-spice branch split` | `gs bsp` | Split one branch into several at chosen commits. `--at COMMIT:NAME`. |
| `git-spice branch squash` | `gs bsq` | Squash the branch's commits into one, restack. `-m`, `--no-edit`. |
| `git-spice branch edit` | `gs be` | `git rebase -i` over just this branch's commits, then restack. |
| `git-spice branch diff` | `gs bdi` | `git diff base...branch`. |

## Stack / upstack / downstack

| Command | Shorthand | Does |
| --- | --- | --- |
| `git-spice stack submit` | `gs ss` | Create/update PRs for the whole current stack. |
| `git-spice stack restack` | `gs sr` | Rebase every branch in the stack onto its base. |
| `git-spice stack edit` | `gs se` | Reorder branches (linear stack) in `$EDITOR`. |
| `git-spice upstack submit` | `gs uss` | Submit current + everything above. |
| `git-spice upstack restack` | `gs usr` | Rebase current + above. `--skip-start`. |
| `git-spice upstack onto [onto]` | `gs uso` | Move current branch **and its upstack** onto a new base. |
| `git-spice downstack submit` | `gs dss` | Submit current + everything below. |
| `git-spice downstack restack` | `gs dsr` | Rebase current + below. |
| `git-spice downstack edit` | `gs dse` | Reorder from current down to trunk. |
| `git-spice downstack track [branch]` | `gs dstr` | Track all untracked branches from here down to trunk (import a hand-built stack). |

## Commit (auto-restacking wrappers)

| Command | Shorthand | Does |
| --- | --- | --- |
| `git-spice commit create` | `gs cc` | `git commit` + auto-restack upstack. `-a/--all`, `-m`, `-F`, `--fixup`, `--no-verify`, `--signoff`, `--[no-]restack`. |
| `git-spice commit amend` | `gs ca` | `git commit --amend` + restack upstack. `--no-edit`, `-a`, `-m`. |
| `git-spice commit split` | `gs csp` | Interactively split HEAD into multiple commits, restack. |

## Rebase (conflict flow)

| Command | Shorthand | Does |
| --- | --- | --- |
| `git-spice rebase continue` | `gs rbc` | Resume the paused git-spice operation after resolving a conflict. |
| `git-spice rebase abort` | `gs rba` | Abort and revert to the pre-rebase state. |

## Submit flags (branch/stack/upstack/downstack submit)

`-n/--dry-run` · `-c/--fill` (title+body from commits) · `--[no-]draft` ·
`--[no-]publish` (`--no-publish` = push without opening a PR) · `-w/--web` ·
`--nav-comment=true|false|multiple` · `--force` · `--no-verify` ·
`-u/--[no-]update-only` (only update existing PRs) · `-l/--label=…` ·
`-r/--reviewer=…` (`user` or `org/team`) · `-a/--assign=…`.

Submission is idempotent — creates the PR if absent, updates it if present.

## Auth

| Command | Does |
| --- | --- |
| `git-spice auth login` | Interactive; pick **Service CLI (gh)** to reuse `gh auth token`. |
| `git-spice auth status` | Non-zero exit if logged out. |
| `git-spice auth logout` | Forget the token. |

Env-var auth (`GITHUB_TOKEN`) overrides everything and disables `auth login` —
CI only.
