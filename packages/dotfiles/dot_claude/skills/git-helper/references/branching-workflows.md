# Branching Strategies and Workflows

## Branching Strategies

### Trunk-Based Development

All developers commit to a single main branch ("trunk"). Short-lived feature branches (1-2 days max) are used, merged frequently. Best for teams practicing continuous integration/deployment.

```
main ─────●───●───●───●───●───●───●──→
           \─●─/       \─●─●─/
           feature-a    feature-b
           (1 day)      (2 days)
```

**When to use**: CI/CD pipelines, small-to-medium teams, rapid iteration, microservices.

**Key practices**:

- Feature flags to hide incomplete work
- Short-lived branches (< 2 days)
- Merge to main at least daily
- Automated testing on every commit
- No long-lived feature branches

```bash
# Typical trunk-based workflow
git switch -c feature/quick-change
# ... make changes ...
git commit -m "feat: add validation"
git push -u origin feature/quick-change
# Create PR, get quick review, merge same day
gh pr create --fill
```

### GitHub Flow

Single main branch with feature branches. PRs are the review mechanism. Deployed from main after merge. Simpler than GitFlow, suits most teams.

```
main ─────●───────●─────────●───────●──→
           \─●─●─/ (PR)     \─●─●─/ (PR)
           feature-a         feature-b
```

**When to use**: Web applications, SaaS, open-source projects, teams that deploy frequently.

**Key practices**:

- `main` is always deployable
- Branch from `main` for any change
- Open PR early for discussion
- Deploy from `main` after merge
- No release branches needed

```bash
# GitHub Flow workflow
git switch -c feature/user-settings
# ... develop feature ...
git push -u origin feature/user-settings
gh pr create --title "feat: user settings page"
# After review and CI passes, merge via PR
```

### GitFlow

Structured branching with long-lived `develop` and `main` branches. Release branches for stabilization. Hotfix branches for production fixes.

```
main    ────●──────────────●──────●──→
             \            / \    /
release      \    release/1.0  hotfix/1.0.1
              \        /
develop ──●──●──●──●──●──●──●──●──→
           \─●─/    \─●─●─/
           feature-a  feature-b
```

**When to use**: Packaged software with formal releases, long release cycles, need for multiple supported versions, large teams.

**Key practices**:

- `main` contains production-ready code with version tags
- `develop` is the integration branch for features
- `release/*` branches for release stabilization
- `hotfix/*` branches for emergency production fixes
- Feature branches merge into `develop`

```bash
# Start a feature
git switch develop
git switch -c feature/new-module

# Start a release
git switch develop
git switch -c release/1.2.0
# ... bug fixes only on release branch ...
git switch main && git merge release/1.2.0
git tag -a v1.2.0 -m "Release 1.2.0"
git switch develop && git merge release/1.2.0

# Emergency hotfix
git switch main
git switch -c hotfix/critical-fix
# ... fix ...
git switch main && git merge hotfix/critical-fix
git tag -a v1.2.1 -m "Hotfix 1.2.1"
git switch develop && git merge hotfix/critical-fix
```

### Choosing a Strategy

| Factor            | Trunk-Based  | GitHub Flow  | GitFlow      |
| ----------------- | ------------ | ------------ | ------------ |
| Team size         | Any          | Small-Medium | Medium-Large |
| Release cadence   | Continuous   | Frequent     | Scheduled    |
| Deploy frequency  | Multiple/day | Daily-Weekly | Per release  |
| Complexity        | Low          | Low          | High         |
| CI/CD maturity    | Required     | Recommended  | Optional     |
| Multiple versions | No           | No           | Yes          |

## Commit Conventions

### Conventional Commits

The standard format adopted by Angular, Vue, and many open-source projects:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types**:

| Type       | Purpose                                       |
| ---------- | --------------------------------------------- |
| `feat`     | New feature (correlates with MINOR in semver) |
| `fix`      | Bug fix (correlates with PATCH in semver)     |
| `docs`     | Documentation only                            |
| `style`    | Formatting, semicolons, etc. (not CSS)        |
| `refactor` | Code change that neither fixes nor adds       |
| `perf`     | Performance improvement                       |
| `test`     | Adding or correcting tests                    |
| `chore`    | Build process, auxiliary tools                |
| `ci`       | CI configuration changes                      |
| `build`    | Build system or external dependency changes   |
| `revert`   | Reverts a previous commit                     |

**Breaking changes**: Add `!` after type or `BREAKING CHANGE:` in footer:

```
feat(api)!: remove deprecated endpoints

BREAKING CHANGE: The /v1/users endpoint has been removed.
Use /v2/users instead.
```

### Commit Message Best Practices

1. **Subject line**: Imperative mood, max 50 characters, no period
   - "Add user validation" not "Added user validation"
2. **Body**: Explain what and why, not how. Wrap at 72 characters
3. **Footer**: Reference issues, breaking changes, co-authors
4. **Scope**: Keep consistent within project (module names, directories)

```bash
# Good commit messages
git commit -m "feat(auth): add OAuth2 PKCE flow for mobile clients"
git commit -m "fix(api): handle null response from payment gateway"
git commit -m "refactor: extract validation logic into shared module"

# Bad commit messages
git commit -m "fix stuff"
git commit -m "WIP"
git commit -m "Updated the code to fix the bug that was happening when users tried to login with their email and password combination and the server returned an error"
```

## Merge vs Rebase

### Merge

Creates a merge commit that combines two branches. Preserves full branch history and topology.

```bash
# Merge feature into main
git switch main
git merge feature/auth

# Merge with no fast-forward (always create merge commit)
git merge --no-ff feature/auth

# Merge with squash (combine all commits, no merge commit)
git merge --squash feature/auth
git commit -m "feat(auth): add authentication module"
```

**Advantages**: Non-destructive, preserves context of when branches existed, simple.
**Disadvantages**: Can create noisy history with many merge commits.

### Rebase

Replays commits on top of another branch. Creates a linear history.

```bash
# Rebase feature onto main
git switch feature/auth
git rebase main

# Interactive rebase for cleanup
git rebase -i main

# After rebase, must force push (branch history changed)
git push --force-with-lease origin feature/auth
```

**Advantages**: Clean, linear history. Easier to read `git log`. Easier `git bisect`.
**Disadvantages**: Rewrites history (do not rebase shared branches). Can be confusing with conflicts.

### When to Use Which

| Scenario                            | Recommendation                 |
| ----------------------------------- | ------------------------------ |
| Integrating feature branch to main  | Merge (--no-ff or squash)      |
| Keeping feature branch up to date   | Rebase onto main               |
| Shared/public branch                | Never rebase (use merge)       |
| Personal/unshared branch            | Rebase for clean history       |
| Long-lived branch with many commits | Interactive rebase, then merge |
| Simple 1-2 commit feature           | Squash merge                   |

### Squash and Merge

Combines all feature branch commits into a single commit on main:

```bash
# Via git
git switch main
git merge --squash feature/auth
git commit -m "feat(auth): complete authentication module"

# Via GitHub PR settings (most common in team workflows)
# Configure in repo Settings > General > Pull Requests:
# "Allow squash merging" with "Default commit message: Pull request title"
```

### Force Push Safety

After rebasing, use `--force-with-lease` instead of `--force`:

```bash
# Safe force push - fails if remote has commits you haven't seen
git push --force-with-lease origin feature/auth

# Even safer - specify expected remote state
git push --force-with-lease=feature/auth:<expected-sha> origin feature/auth

# NEVER force push to main/master/develop
# NEVER use --force (use --force-with-lease instead)
```

## Signed Commits

### SSH Signing (Recommended, simplest)

```bash
# Configure SSH signing
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub

# Sign all commits by default
git config --global commit.gpgsign true

# Sign all tags by default
git config --global tag.gpgsign true

# Verify signatures
git log --show-signature
git verify-commit <sha>
```

### GPG Signing

```bash
# List GPG keys
gpg --list-secret-keys --keyid-format=long

# Configure GPG signing
git config --global user.signingkey <key-id>
git config --global commit.gpgsign true

# Sign a single commit
git commit -S -m "feat: signed commit"

# Sign a tag
git tag -s v1.0.0 -m "Release 1.0.0"

# Verify
git verify-commit <sha>
git verify-tag v1.0.0
```

### SSH Allowed Signers

For verifying SSH signatures locally:

```bash
# Create allowed signers file
echo "user@example.com ssh-ed25519 AAAA..." > ~/.ssh/allowed_signers

# Configure Git to use it
git config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers

# Now verification works
git verify-commit HEAD
```

## Tag Management

### Tag Types

```bash
# Lightweight tag (just a pointer, no metadata)
git tag v1.0.0

# Annotated tag (recommended for releases - stores tagger, date, message)
git tag -a v1.0.0 -m "Release 1.0.0: initial stable release"

# Signed tag (annotated + cryptographic signature)
git tag -s v1.0.0 -m "Release 1.0.0"

# Tag a specific commit
git tag -a v1.0.0 <sha> -m "Release 1.0.0"
```

### Tag Operations

```bash
# List tags
git tag                         # All tags
git tag -l "v1.*"              # Pattern matching
git tag -l --sort=-version:refname  # Sort by version descending

# Show tag details
git show v1.0.0

# Push tags
git push origin v1.0.0         # Push specific tag
git push origin --tags          # Push all tags

# Delete tags
git tag -d v1.0.0              # Delete local tag
git push origin --delete v1.0.0 # Delete remote tag

# Rename a tag (delete old, create new)
git tag new-name old-name
git tag -d old-name
git push origin new-name :old-name
```

### Semantic Versioning with Tags

Follow [SemVer](https://semver.org/): `MAJOR.MINOR.PATCH`

```bash
# Version tags
git tag -a v1.0.0 -m "1.0.0: initial release"
git tag -a v1.1.0 -m "1.1.0: add user profiles"       # New feature
git tag -a v1.1.1 -m "1.1.1: fix profile loading"      # Bug fix
git tag -a v2.0.0 -m "2.0.0: redesigned API"           # Breaking change

# Pre-release tags
git tag -a v2.0.0-alpha.1 -m "2.0.0 Alpha 1"
git tag -a v2.0.0-beta.1 -m "2.0.0 Beta 1"
git tag -a v2.0.0-rc.1 -m "2.0.0 Release Candidate 1"
```

**Best practices**:

- Use annotated tags for releases (they store metadata)
- Use lightweight tags for personal/temporary markers
- Use signed tags for published/distributed software
- Always push tags explicitly (`--tags`)

## Release Workflows

### Tag-Based Releases

```bash
# Create release tag
git switch main
git pull origin main
git tag -a v1.2.0 -m "Release 1.2.0"
git push origin v1.2.0

# Create GitHub release from tag
gh release create v1.2.0 --title "v1.2.0" --notes "Release notes here"

# Create release with auto-generated notes
gh release create v1.2.0 --generate-notes

# Create pre-release
gh release create v2.0.0-beta.1 --prerelease --generate-notes
```

### Release Branch Workflow

```bash
# Cut a release branch
git switch main
git switch -c release/1.2.0

# Only bug fixes on release branch
git commit -m "fix: correct validation error message"

# When ready to release
git switch main
git merge --no-ff release/1.2.0
git tag -a v1.2.0 -m "Release 1.2.0"
git push origin main --follow-tags

# Back-merge release fixes to develop (if using GitFlow)
git switch develop
git merge release/1.2.0
git push origin develop

# Clean up
git branch -d release/1.2.0
git push origin --delete release/1.2.0
```

### Hotfix Workflow

```bash
# Branch from the release tag
git switch -c hotfix/1.2.1 v1.2.0

# Make the fix
git commit -m "fix: critical security vulnerability"

# Merge to main and tag
git switch main
git merge --no-ff hotfix/1.2.1
git tag -a v1.2.1 -m "Hotfix 1.2.1: security fix"
git push origin main --follow-tags

# Also merge fix to develop/current release
git switch develop
git merge hotfix/1.2.1

# Clean up
git branch -d hotfix/1.2.1
```
