---
description: Comprehensive workspace diagnostics and productivity dashboard
---

# Workspace Diagnostics

This command provides a comprehensive overview of your development environment and current work status.

```bash
#!/bin/bash
set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  WORKSPACE DIAGNOSTICS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ═══════════════════════════════════════════════════════
# GIT STATUS OVERVIEW
# ═══════════════════════════════════════════════════════
echo "┌─ GIT STATUS ─────────────────────────────────────┐"

if git rev-parse --git-dir > /dev/null 2>&1; then
    # Current branch
    BRANCH=$(git branch --show-current)
    echo -e "  Branch:     ${BLUE}${BRANCH}${NC}"

    # Uncommitted changes
    UNCOMMITTED=$(git status --porcelain | wc -l | tr -d ' ')
    if [ "$UNCOMMITTED" -eq 0 ]; then
        echo -e "  Changes:    ${GREEN}✓${NC} Clean working directory"
    else
        echo -e "  Changes:    ${YELLOW}!${NC} $UNCOMMITTED uncommitted file(s)"
    fi

    # Stash count
    STASH_COUNT=$(git stash list | wc -l | tr -d ' ')
    if [ "$STASH_COUNT" -eq 0 ]; then
        echo -e "  Stashes:    ${GREEN}✓${NC} None"
    else
        echo -e "  Stashes:    ${YELLOW}!${NC} $STASH_COUNT stash(es)"
    fi

    # Ahead/behind remote
    if git rev-parse --abbrev-ref --symbolic-full-name @{u} > /dev/null 2>&1; then
        AHEAD=$(git rev-list --count @{u}..HEAD)
        BEHIND=$(git rev-list --count HEAD..@{u})
        if [ "$AHEAD" -gt 0 ] || [ "$BEHIND" -gt 0 ]; then
            echo -e "  Remote:     ${YELLOW}↑${NC} $AHEAD ahead, ${YELLOW}↓${NC} $BEHIND behind"
        else
            echo -e "  Remote:     ${GREEN}✓${NC} In sync"
        fi
    fi
else
    echo -e "  ${RED}✗${NC} Not a git repository"
fi

echo "└──────────────────────────────────────────────────┘"
echo ""

# ═══════════════════════════════════════════════════════
# ENVIRONMENT DIAGNOSTICS
# ═══════════════════════════════════════════════════════
echo "┌─ ENVIRONMENT ────────────────────────────────────┐"

check_tool() {
    local tool=$1
    local version_flag=${2:---version}

    if command -v "$tool" &> /dev/null; then
        local version=$(eval "$tool $version_flag 2>&1" | head -n1)
        echo -e "  ${GREEN}✓${NC} $tool: $version"
    else
        echo -e "  ${RED}✗${NC} $tool: not installed"
    fi
}

# Check common development tools
check_tool "node" "--version"
check_tool "bun" "--version"
check_tool "git" "--version"
check_tool "gh" "--version"
check_tool "docker" "--version"
check_tool "kubectl" "version --client --short"
check_tool "op" "--version"

echo "└──────────────────────────────────────────────────┘"
echo ""

# ═══════════════════════════════════════════════════════
# GIT WORKTREES (if any)
# ═══════════════════════════════════════════════════════
if git rev-parse --git-dir > /dev/null 2>&1; then
    WORKTREE_COUNT=$(git worktree list | wc -l | tr -d ' ')

    if [ "$WORKTREE_COUNT" -gt 1 ]; then
        echo "┌─ ACTIVE WORKTREES ───────────────────────────────┐"
        echo ""

        # Header
        printf "  %-40s %-20s\n" "PATH" "BRANCH"
        echo "  ────────────────────────────────────────────────────────"

        # List worktrees
        git worktree list --porcelain | awk '
            BEGIN { path=""; branch=""; }
            /^worktree / { path=$2 }
            /^branch / {
                split($0, parts, "refs/heads/")
                branch = parts[2]
                # Truncate long paths
                if (length(path) > 38) {
                    short_path = "..." substr(path, length(path)-35)
                } else {
                    short_path = path
                }
                printf "  %-40s %s\n", short_path, branch
                path=""; branch=""
            }
        '

        echo ""
        echo "└──────────────────────────────────────────────────┘"
        echo ""
    fi
fi

# ═══════════════════════════════════════════════════════
# PRODUCTIVITY STATS
# ═══════════════════════════════════════════════════════
echo "┌─ PRODUCTIVITY ───────────────────────────────────┐"

if git rev-parse --git-dir > /dev/null 2>&1; then
    # Commits today
    COMMITS_TODAY=$(git log --since="00:00:00" --oneline --author="$(git config user.email)" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "  Today:      ${BLUE}$COMMITS_TODAY${NC} commit(s)"

    # Commits this week
    COMMITS_WEEK=$(git log --since="1 week ago" --oneline --author="$(git config user.email)" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "  This week:  ${BLUE}$COMMITS_WEEK${NC} commit(s)"

    # Recent commits (last 3)
    echo ""
    echo "  Recent commits:"
    git log -3 --pretty=format:"    %C(auto)%h%Creset %C(dim)%ar%Creset %s" --author="$(git config user.email)" 2>/dev/null || echo "    No commits found"
    echo ""

    # PR status (if gh is available)
    if command -v gh &> /dev/null; then
        echo ""
        PR_COUNT=$(gh pr list --state open --author @me --json number 2>/dev/null | jq '. | length' 2>/dev/null || echo "0")
        if [ "$PR_COUNT" -gt 0 ]; then
            echo -e "  Open PRs:   ${YELLOW}$PR_COUNT${NC}"
            gh pr list --state open --author @me --limit 3 2>/dev/null | sed 's/^/    /' || true
        else
            echo -e "  Open PRs:   ${GREEN}0${NC}"
        fi
    fi
else
    echo "  Not a git repository"
fi

echo ""
echo "└──────────────────────────────────────────────────┘"
echo ""

# ═══════════════════════════════════════════════════════
# CURRENT DIRECTORY INFO
# ═══════════════════════════════════════════════════════
echo "┌─ CURRENT LOCATION ───────────────────────────────┐"
echo "  $(pwd)"
echo "└──────────────────────────────────────────────────┘"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```
