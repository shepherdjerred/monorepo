#!/bin/bash
#
# Git Cleanup Script
#
# Cleans up Git repositories by:
# - Removing worktrees for merged/deleted branches (moved to Trash if available)
# - Deleting local branches that are merged
# - Checking GitHub PR status and cleaning branches with closed/merged PRs
# - Pruning stale remote tracking branches
# - Updating default branch and clearing stashes
# - SAFETY: Never deletes worktrees with unpushed commits
#
# Usage:
#   git_cleanup.sh [directory]
#
# Safety Features:
#   - Uses macOS Trash instead of rm (install trash: brew install trash)
#   - Never deletes worktrees with unpushed commits (override with FORCE_DELETE_UNPUSHED=true)
#   - Always checks for uncommitted changes before deletion
#   - DRY_RUN mode to preview all changes
#
# Environment variables:
#   DRY_RUN=true                    - Preview changes without making them (default: false)
#   CHECK_PRS=true                  - Check GitHub PR status (default: true, requires gh CLI)
#   CLEANUP_CLOSED_PRS=true         - Delete branches with closed PRs (default: true)
#   CLEANUP_CLEAN_WORKTREES=false   - Delete clean worktrees (no changes, no commits ahead) (default: false)
#   FORCE_DELETE_UNPUSHED=false     - Delete worktrees even with unpushed commits (NOT RECOMMENDED) (default: false)
#   STALE_PR_DAYS=21                - Days of inactivity for stale PR warnings (default: 21)
#   SHOW_SUMMARY=false              - Show before/after branch/PR listings (default: false)
#   VERBOSE=false                   - Show all repos or only repos with changes (default: false)
#   NO_COLOR=true                   - Disable colored output (default: false)
#
# Examples:
#   git_cleanup.sh                                  # Clean ~/git (safe mode)
#   git_cleanup.sh ~/projects                       # Clean ~/projects
#   DRY_RUN=true git_cleanup.sh                     # Preview changes (recommended first run)
#   CLEANUP_CLOSED_PRS=false git_cleanup.sh         # Keep branches with closed PRs
#   CLEANUP_CLEAN_WORKTREES=true git_cleanup.sh     # Delete clean worktrees (safe: no unpushed commits)
#   SHOW_SUMMARY=true VERBOSE=true git_cleanup.sh   # Show full details
#   NO_COLOR=true git_cleanup.sh                    # Disable colors
#

set -euo pipefail

# Color configuration
if [ -t 1 ] && [ "${NO_COLOR:-}" != "true" ]; then
    # Color codes
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    DIM='\033[2m'
    RESET='\033[0m'
else
    # No colors
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    CYAN=''
    BOLD=''
    DIM=''
    RESET=''
fi

# Helper functions for colored output
print_header() {
    echo -e "${BOLD}${CYAN}=== $1 ===${RESET}"
}

print_section() {
    echo -e "${BOLD}  $1${RESET}"
}

print_success() {
    echo -e "${GREEN}  ✓ $1${RESET}"
}

print_warning() {
    echo -e "${YELLOW}  ⚠ WARNING: $1${RESET}"
}

print_error() {
    echo -e "${RED}  ✗ $1${RESET}"
}

print_info() {
    echo -e "${DIM}  $1${RESET}"
}

print_action() {
    echo -e "${BLUE}  → $1${RESET}"
}

# Check if trash command is available (safer than rm)
HAS_TRASH=false
if command -v trash &> /dev/null; then
    HAS_TRASH=true
fi

# Helper function to safely remove files/directories
# Uses trash if available, otherwise falls back to rm with confirmation
safe_remove() {
    local path="$1"
    local item_type="${2:-file}"  # 'file' or 'directory'

    if [ "$HAS_TRASH" = "true" ]; then
        trash "$path" 2>/dev/null && return 0
    fi

    # Fallback: use rm (but this shouldn't happen if we check properly)
    if [ "$item_type" = "directory" ]; then
        rm -rf "$path" 2>/dev/null && return 0
    else
        rm -f "$path" 2>/dev/null && return 0
    fi

    return 1
}

# Show help
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    head -n 25 "$0" | grep "^#" | sed 's/^# \?//'
    exit 0
fi

GIT_DIR="${1:-$HOME/git}"
DRY_RUN="${DRY_RUN:-false}"
CHECK_PRS="${CHECK_PRS:-true}"
CLEANUP_CLOSED_PRS="${CLEANUP_CLOSED_PRS:-true}"
CLEANUP_CLEAN_WORKTREES="${CLEANUP_CLEAN_WORKTREES:-false}"
STALE_PR_DAYS="${STALE_PR_DAYS:-21}"
SHOW_SUMMARY="${SHOW_SUMMARY:-false}"
VERBOSE="${VERBOSE:-false}"
FORCE_DELETE_UNPUSHED="${FORCE_DELETE_UNPUSHED:-false}"

# Check if GitHub CLI is available
HAS_GH=false
if command -v gh &> /dev/null; then
    HAS_GH=true
    echo "GitHub CLI detected - will check PR status"
else
    echo "GitHub CLI not found - skipping PR status checks (install with 'brew install gh')"
    CHECK_PRS=false
fi

# Check if trash command is available
if [ "$HAS_TRASH" = "true" ]; then
    echo "Trash command detected - deleted items will go to macOS Trash (safer)"
else
    echo "WARNING: trash command not found - will use rm instead (install with 'brew install trash')"
fi

echo "Scanning for worktrees in $GIT_DIR..."
echo "Settings: DRY_RUN=$DRY_RUN, CHECK_PRS=$CHECK_PRS, CLEANUP_CLOSED_PRS=$CLEANUP_CLOSED_PRS, CLEANUP_CLEAN_WORKTREES=$CLEANUP_CLEAN_WORKTREES, STALE_PR_DAYS=$STALE_PR_DAYS"
echo ""

# Track repos for summary
declare -a REPOS_WITH_CHANGES=()
declare -a REPOS_NO_CHANGES=()
declare -a STALE_PRS_SUMMARY=()

# Function to check PR status for a branch
# Returns: "merged", "closed", "open", "none", or "error"
check_pr_status() {
    local branch="$1"
    local repo_path="$2"

    if [ "$HAS_GH" = "false" ] || [ "$CHECK_PRS" = "false" ]; then
        echo "none"
        return
    fi

    cd "$repo_path"

    # Check if this is a GitHub repo
    local remote_url
    remote_url=$(git remote get-url origin 2>/dev/null || echo "")
    if [[ ! "$remote_url" =~ github\.com ]]; then
        echo "none"
        return
    fi

    # Get PR status for this branch
    local pr_state
    pr_state=$(gh pr list --head "$branch" --json state,closed --jq '.[0] | if .state == "MERGED" then "merged" elif .closed then "closed" elif .state == "OPEN" then "open" else "none" end' 2>/dev/null || echo "none")

    echo "$pr_state"
}

# List all branches for a repository
list_all_branches() {
    local repo_path="$1"
    cd "$repo_path"

    echo -e "${DIM}    Local branches:${RESET}"
    git branch | sed "s/^/      /"

    echo -e "${DIM}    Remote branches:${RESET}"
    git branch -r | grep -v "HEAD" | sed "s/^/      /"
}

# List all PRs for a repository with colored state
list_all_prs() {
    local repo_path="$1"

    if [ "$HAS_GH" = "false" ]; then
        print_info "[GitHub CLI not available]"
        return
    fi

    cd "$repo_path"

    local remote_url
    remote_url=$(git remote get-url origin 2>/dev/null || echo "")
    if [[ ! "$remote_url" =~ github\.com ]]; then
        print_info "[Not a GitHub repository]"
        return
    fi

    local prs
    prs=$(gh pr list --state all --json number,headRefName,state,title --limit 100 2>/dev/null || echo "[]")

    if [ "$prs" = "[]" ]; then
        print_info "No PRs found"
        return
    fi

    # Color code by state: OPEN=green, MERGED=blue, CLOSED=red
    echo "$prs" | jq -r '.[] | "\(.number)|\(.headRefName)|\(.state)|\(.title)"' 2>/dev/null | while IFS='|' read -r num branch state title; do
        case "$state" in
            "OPEN")
                echo -e "    ${GREEN}#${num}${RESET} - ${branch} ${GREEN}[OPEN]${RESET} - ${title}"
                ;;
            "MERGED")
                echo -e "    ${BLUE}#${num}${RESET} - ${branch} ${BLUE}[MERGED]${RESET} - ${title}"
                ;;
            "CLOSED")
                echo -e "    ${RED}#${num}${RESET} - ${branch} ${RED}[CLOSED]${RESET} - ${title}"
                ;;
        esac
    done
}

# Check if a worktree is clean (no uncommitted changes, no commits ahead)
is_worktree_clean() {
    local worktree_path="$1"
    local branch="$2"
    local default_branch="$3"

    cd "$worktree_path" 2>/dev/null || return 1

    # Check for uncommitted changes
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        return 1
    fi

    # Check for commits ahead of default branch
    local commits_ahead
    commits_ahead=$(git rev-list --count "origin/$default_branch..HEAD" 2>/dev/null || echo "999")

    if [ "$commits_ahead" != "0" ]; then
        return 1
    fi

    return 0
}

# Check if a worktree has unpushed commits
has_unpushed_commits() {
    local worktree_path="$1"
    local branch="$2"

    cd "$worktree_path" 2>/dev/null || return 1

    # Check if branch has upstream configured
    local upstream
    upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo "")

    if [ -z "$upstream" ]; then
        # No upstream configured - check if there are any commits
        local commit_count
        commit_count=$(git rev-list --count HEAD 2>/dev/null || echo "0")
        if [ "$commit_count" -gt 0 ]; then
            return 0  # Has commits but no upstream = unpushed
        else
            return 1  # No commits at all
        fi
    fi

    # Check for commits ahead of upstream
    local commits_ahead
    commits_ahead=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo "0")

    if [ "$commits_ahead" -gt 0 ]; then
        return 0  # Has unpushed commits
    else
        return 1  # No unpushed commits
    fi
}

# Check if a PR is stale (inactive for specified days)
check_pr_staleness() {
    local branch="$1"
    local repo_path="$2"
    local days_threshold="${3:-21}"

    if [ "$HAS_GH" = "false" ]; then
        echo "none"
        return
    fi

    cd "$repo_path"

    local updated_at
    updated_at=$(gh pr list --head "$branch" --json updatedAt --jq '.[0].updatedAt' 2>/dev/null || echo "")

    if [ -z "$updated_at" ]; then
        echo "none"
        return
    fi

    # Convert to epoch (macOS compatible)
    local pr_timestamp
    pr_timestamp=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$updated_at" "+%s" 2>/dev/null || echo "0")
    local current_timestamp
    current_timestamp=$(date -u "+%s")
    local days_inactive=$(( (current_timestamp - pr_timestamp) / 86400 ))

    if [ "$days_inactive" -ge "$days_threshold" ]; then
        echo "stale:$days_inactive"
    else
        echo "active"
    fi
}

# Find all git directories that are main worktrees (have a .git directory, not a file)
for repo in "$GIT_DIR"/*/; do
    [ -d "$repo" ] || continue

    # Skip if not a git repo
    [ -e "$repo/.git" ] || continue

    # Skip if this is a worktree (has .git file pointing elsewhere)
    if [ -f "$repo/.git" ]; then
        continue
    fi

    repo_name=$(basename "$repo")

    cd "$repo"

    # Fetch latest to ensure we have up-to-date remote info
    git fetch --prune origin >/dev/null 2>&1 || true

    # Get the default branch
    default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

    # Track if this repo has any actions
    repo_has_changes=false
    repo_header_printed=false

    # Display BEFORE section if SHOW_SUMMARY=true or print header if VERBOSE=true
    if [ "$SHOW_SUMMARY" = "true" ]; then
        print_header "$repo_name"
        repo_header_printed=true
        print_section "--- BEFORE CLEANUP ---"
        echo ""
        print_section "All branches:"
        list_all_branches "$repo"
        echo ""
        print_section "All PRs:"
        list_all_prs "$repo"
        echo ""
        print_section "--- STARTING CLEANUP ---"
        echo ""
    elif [ "$VERBOSE" = "true" ]; then
        print_header "$repo_name"
        repo_header_printed=true
    fi

    # Get the main worktree path (first line of worktree list)
    main_worktree=$(git worktree list | head -1 | awk '{print $1}')

    # List all worktrees
    while IFS= read -r line; do
        worktree_path=$(echo "$line" | awk '{print $1}')
        branch=$(echo "$line" | sed -n 's/.*\[\(.*\)\].*/\1/p')

        # Skip the main worktree (always keep it)
        if [ "$worktree_path" = "$main_worktree" ]; then
            continue
        fi

        # Skip if no branch info (detached HEAD, etc)
        if [ -z "$branch" ]; then
            continue
        fi

        # Check if branch has a remote tracking branch configured
        has_upstream=$(git config --get "branch.$branch.remote" 2>/dev/null || echo "")

        # Check if branch exists on remote
        remote_exists=$(git ls-remote --heads origin "$branch" 2>/dev/null | wc -l | tr -d ' ')

        # Check if branch is merged into default branch
        is_merged=false
        if git branch --merged "origin/$default_branch" 2>/dev/null | grep -q "^\s*$branch$\|^\*\s*$branch$"; then
            is_merged=true
        fi

        # Check PR status
        pr_status=$(check_pr_status "$branch" "$repo")

        # Determine if we should remove this worktree
        should_remove=false
        reason=""

        # Only consider it "deleted" if it HAD a remote tracking branch that's now gone
        if [ -n "$has_upstream" ] && [ "$remote_exists" = "0" ]; then
            should_remove=true
            reason="remote branch deleted"
        elif [ "$is_merged" = "true" ]; then
            should_remove=true
            reason="merged into $default_branch"
        elif [ "$pr_status" = "merged" ]; then
            should_remove=true
            reason="PR merged"
        elif [ "$pr_status" = "closed" ] && [ "$CLEANUP_CLOSED_PRS" = "true" ]; then
            should_remove=true
            reason="PR closed without merge"
        fi

        # Check if worktree is clean (even if not merged)
        if [ "$should_remove" = "false" ] && [ "$CLEANUP_CLEAN_WORKTREES" = "true" ]; then
            if is_worktree_clean "$worktree_path" "$branch" "$default_branch"; then
                should_remove=true
                reason="clean worktree (no changes, no commits ahead)"
            fi
        fi

        # SAFETY CHECK: Don't delete if there are unpushed commits (unless forced)
        if [ "$should_remove" = "true" ] && [ "$FORCE_DELETE_UNPUSHED" = "false" ]; then
            if has_unpushed_commits "$worktree_path" "$branch"; then
                should_remove=false
                reason="HAS UNPUSHED COMMITS - keeping for safety"
                has_unpushed=true
            fi
        fi

        # Print header only when first change is detected
        if [ "$repo_header_printed" = "false" ]; then
            if [ "$should_remove" = "true" ] || is_worktree_clean "$worktree_path" "$branch" "$default_branch" || [ "${has_unpushed:-false}" = "true" ]; then
                print_header "$repo_name"
                repo_header_printed=true
                repo_has_changes=true
            fi
        fi

        # Remove worktree if conditions are met
        if [ "$should_remove" = "true" ]; then
            repo_has_changes=true

            if [ "$DRY_RUN" = "true" ]; then
                print_warning "Would remove: $worktree_path ($branch - $reason)"
            else
                print_action "Removing: $worktree_path ($branch - $reason)"
                # First remove from git worktree, then move directory to trash
                if git worktree remove "$worktree_path" --force 2>/dev/null; then
                    print_success "Removed worktree from git"
                else
                    # If git worktree remove fails, manually remove
                    if safe_remove "$worktree_path" "directory"; then
                        if [ "$HAS_TRASH" = "true" ]; then
                            print_success "Moved worktree to Trash"
                        else
                            print_success "Removed worktree"
                        fi
                    else
                        print_error "Failed to remove worktree"
                    fi
                fi
                # Delete the branch
                if git branch -D "$branch" 2>/dev/null; then
                    print_success "Deleted branch: $branch"
                fi
            fi
        elif [ "${has_unpushed:-false}" = "true" ]; then
            # Show warning for worktrees with unpushed commits
            repo_has_changes=true
            print_warning "SAFETY: Keeping worktree with unpushed commits: $worktree_path ($branch)"
            print_info "  → Use FORCE_DELETE_UNPUSHED=true to override (not recommended)"
        else
            # Only print kept worktrees if VERBOSE or has interesting status
            if is_worktree_clean "$worktree_path" "$branch" "$default_branch"; then
                if [ "$CLEANUP_CLEAN_WORKTREES" = "true" ]; then
                    # This shouldn't happen, but just in case
                    print_warning "Clean worktree kept: $worktree_path ($branch)"
                else
                    print_info "Keeping: $worktree_path ($branch - ${YELLOW}CLEAN${RESET}, set CLEANUP_CLEAN_WORKTREES=true to remove)"
                    repo_has_changes=true
                fi
            elif [ "$VERBOSE" = "true" ]; then
                status_info="not merged"
                [ "$pr_status" != "none" ] && status_info="$status_info, PR: $pr_status"
                print_info "Keeping: $worktree_path ($branch - $status_info)"
            fi
        fi
    done < <(git worktree list)

    # Prune any stale worktree references
    git worktree prune 2>/dev/null || true

    # Clean up remote tracking branches that no longer exist on remote
    pruned=$(git remote prune origin --dry-run 2>/dev/null | grep -c "^\s*\*" || echo "0")
    if [ "$pruned" -gt 0 ]; then
        if [ "$repo_header_printed" = "false" ]; then
            print_header "$repo_name"
            repo_header_printed=true
        fi
        repo_has_changes=true

        if [ "$DRY_RUN" = "true" ]; then
            print_warning "Would prune $pruned remote tracking branch(es)"
            git remote prune origin --dry-run 2>/dev/null | grep "^\s*\*" | sed 's/^/    /'
        else
            git remote prune origin 2>/dev/null
            print_success "Pruned $pruned remote tracking branch(es)"
        fi
    elif [ "$VERBOSE" = "true" ]; then
        print_info "No stale remote tracking branches"
    fi

    # Delete merged local branches (excluding default and current)
    merged_branches=$(git branch --merged "origin/$default_branch" 2>/dev/null | grep -v "^\*" | grep -v "^[[:space:]]*$default_branch$" | sed 's/^[[:space:]]*+//' | tr -d ' ' || true)
    if [ -n "$merged_branches" ]; then
        if [ "$repo_header_printed" = "false" ]; then
            print_header "$repo_name"
            repo_header_printed=true
        fi
        repo_has_changes=true

        print_section "Cleaning merged local branches:"
        for branch in $merged_branches; do
            if [ "$DRY_RUN" = "true" ]; then
                print_warning "Would delete branch: $branch"
            else
                if git branch -d "$branch" 2>/dev/null; then
                    print_success "Deleted: $branch (merged)"
                fi
            fi
        done
    fi

    # Check for branches with closed/merged PRs (even if not merged locally)
    if [ "$CHECK_PRS" = "true" ] && [ "$HAS_GH" = "true" ]; then
        # Get all local branches except current and default
        all_branches=$(git branch 2>/dev/null | grep -v "^\*" | grep -v "^[[:space:]]*$default_branch$" | sed 's/^[[:space:]]*+//' | tr -d ' ' || true)

        branches_deleted=0
        for branch in $all_branches; do
            # Skip if already processed as merged
            if echo "$merged_branches" | grep -q "^${branch}$"; then
                continue
            fi

            pr_status=$(check_pr_status "$branch" "$repo")

            should_delete=false
            delete_reason=""

            if [ "$pr_status" = "merged" ]; then
                should_delete=true
                delete_reason="PR merged"
            elif [ "$pr_status" = "closed" ] && [ "$CLEANUP_CLOSED_PRS" = "true" ]; then
                should_delete=true
                delete_reason="PR closed"
            fi

            if [ "$should_delete" = "true" ]; then
                if [ "$repo_header_printed" = "false" ]; then
                    print_header "$repo_name"
                    repo_header_printed=true
                fi
                repo_has_changes=true

                if [ "$DRY_RUN" = "true" ]; then
                    print_warning "Would delete branch: $branch ($delete_reason)"
                else
                    if git branch -D "$branch" 2>/dev/null; then
                        print_success "Deleted: $branch ($delete_reason)"
                        branches_deleted=$((branches_deleted + 1))
                    fi
                fi
            fi
        done
    fi

    # Check for stale PRs and issue warnings
    if [ "$CHECK_PRS" = "true" ] && [ "$HAS_GH" = "true" ]; then
        # Get all local branches
        all_branches=$(git branch 2>/dev/null | grep -v "^\*" | sed 's/^[[:space:]]*+//' | tr -d ' ' || true)

        stale_pr_count=0
        for branch in $all_branches; do
            staleness=$(check_pr_staleness "$branch" "$repo" "$STALE_PR_DAYS")

            if [[ "$staleness" == stale:* ]]; then
                if [ "$repo_header_printed" = "false" ]; then
                    print_header "$repo_name"
                    repo_header_printed=true
                fi
                repo_has_changes=true

                days_inactive="${staleness#stale:}"
                pr_info=$(gh pr list --head "$branch" --json number,title --jq '.[0] | "#\(.number) - \(.title)"' 2>/dev/null || echo "unknown")

                print_warning "Stale PR (${days_inactive} days inactive): $branch - $pr_info"
                STALE_PRS_SUMMARY+=("$repo_name: $branch (${days_inactive} days) - $pr_info")
                stale_pr_count=$((stale_pr_count + 1))
            fi
        done

        if [ "$stale_pr_count" = "0" ] && [ "$VERBOSE" = "true" ]; then
            print_success "No stale PRs found"
        fi
    fi

    # Check for uncommitted changes
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        if [ "$repo_header_printed" = "false" ]; then
            print_header "$repo_name"
            repo_header_printed=true
        fi
        repo_has_changes=true
        print_warning "Repo has uncommitted changes, skipping checkout/pull/stash-clear"

        # Track repo and continue to next
        if [ "$repo_has_changes" = "true" ]; then
            REPOS_WITH_CHANGES+=("$repo_name")
        else
            REPOS_NO_CHANGES+=("$repo_name")
        fi
        continue
    fi

    # Checkout default branch
    current_branch=$(git branch --show-current 2>/dev/null || true)
    if [ "$current_branch" != "$default_branch" ]; then
        if [ "$VERBOSE" = "true" ]; then
            if [ "$DRY_RUN" = "true" ]; then
                print_warning "Would checkout $default_branch (currently on $current_branch)"
            else
                if git checkout "$default_branch" 2>/dev/null; then
                    print_success "Checked out $default_branch"
                else
                    print_error "Failed to checkout $default_branch"
                fi
            fi
        else
            git checkout "$default_branch" >/dev/null 2>&1 || true
        fi
    fi

    # Pull latest
    if [ "$VERBOSE" = "true" ]; then
        if [ "$DRY_RUN" = "true" ]; then
            print_warning "Would pull latest"
        else
            if git pull >/dev/null 2>&1; then
                print_success "Pulled latest"
            else
                print_error "Failed to pull"
            fi
        fi
    else
        git pull >/dev/null 2>&1 || true
    fi

    # Drop stashes
    stash_count=$(git stash list 2>/dev/null | wc -l | tr -d ' ')
    if [ "$stash_count" -gt 0 ]; then
        if [ "$repo_header_printed" = "false" ]; then
            print_header "$repo_name"
            repo_header_printed=true
        fi
        repo_has_changes=true

        if [ "$DRY_RUN" = "true" ]; then
            print_warning "Would drop $stash_count stash(es)"
        else
            if git stash clear; then
                print_success "Dropped $stash_count stash(es)"
            fi
        fi
    fi

    # Display AFTER section if SHOW_SUMMARY=true
    if [ "$SHOW_SUMMARY" = "true" ]; then
        echo ""
        print_section "--- AFTER CLEANUP ---"
        echo ""
        print_section "Remaining branches:"
        list_all_branches "$repo"
        echo ""
        print_section "Remaining open PRs:"

        if [ "$HAS_GH" = "true" ]; then
            cd "$repo"
            remote_url=$(git remote get-url origin 2>/dev/null || echo "")
            if [[ "$remote_url" =~ github\.com ]]; then
                open_prs=$(gh pr list --state open --json number,headRefName,title 2>/dev/null || echo "[]")
                if [ "$open_prs" = "[]" ]; then
                    print_info "No open PRs"
                else
                    echo "$open_prs" | jq -r '.[] | "\(.number)|\(.headRefName)|\(.title)"' | while IFS='|' read -r num branch title; do
                        echo -e "    ${GREEN}#${num}${RESET} - ${branch} - ${title}"
                    done
                fi
            fi
        fi
        echo ""
        print_section "--- CLEANUP COMPLETE ---"
        echo ""
    fi

    # Track repos with/without changes
    if [ "$repo_has_changes" = "true" ]; then
        REPOS_WITH_CHANGES+=("$repo_name")
    else
        REPOS_NO_CHANGES+=("$repo_name")
    fi
done

echo ""
print_header "CLEANUP SUMMARY"
echo ""

# Show repos with changes
if [ "${#REPOS_WITH_CHANGES[@]}" -gt 0 ]; then
    print_section "Repositories with changes (${#REPOS_WITH_CHANGES[@]}):"
    for repo_name in "${REPOS_WITH_CHANGES[@]}"; do
        echo -e "  ${GREEN}✓${RESET} $repo_name"
    done
    echo ""
fi

# Show repos with no changes (only if VERBOSE)
if [ "$VERBOSE" = "true" ] && [ "${#REPOS_NO_CHANGES[@]}" -gt 0 ]; then
    print_section "Repositories with no changes (${#REPOS_NO_CHANGES[@]}):"
    for repo_name in "${REPOS_NO_CHANGES[@]}"; do
        echo -e "  ${DIM}○${RESET} ${DIM}$repo_name${RESET}"
    done
    echo ""
elif [ "${#REPOS_NO_CHANGES[@]}" -gt 0 ]; then
    print_info "${#REPOS_NO_CHANGES[@]} repositories had no changes"
    echo ""
fi

# Stale PR summary
if [ "${#STALE_PRS_SUMMARY[@]}" -gt 0 ]; then
    print_section "⚠  STALE PRS DETECTED (${#STALE_PRS_SUMMARY[@]} total):"
    for summary_line in "${STALE_PRS_SUMMARY[@]}"; do
        echo -e "  ${YELLOW}⚠${RESET}  $summary_line"
    done
    echo ""
fi

print_success "Cleanup complete!"
