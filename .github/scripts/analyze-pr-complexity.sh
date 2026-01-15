#!/bin/bash
set -eu

# ============================================================================
# PR Complexity Analysis Script
# ============================================================================
# Outputs:
#   should_skip: true/false - Skip review entirely for trivial PRs
#   max_turns: 10-30 - Dynamic based on PR size
#   is_rereview: true/false - Is this a re-review of updated PR?
#   previous_state: APPROVED/CHANGES_REQUESTED/COMMENTED/none
#   previous_was_approved: true/false - Was last review APPROVED?
#   complexity: simple/medium/complex - PR complexity classification
#   total_changes: number - Total line changes
#   changed_files: number - Number of files changed
# ============================================================================

PR_NUMBER="${PR_NUMBER}"
BASE_REF="${BASE_REF}"
HEAD_SHA="${HEAD_SHA}"

echo "============================================================================"
echo "Analyzing PR #${PR_NUMBER}"
echo "============================================================================"

# ----------------------------------------------------------------------------
# 1. FETCH PR DATA
# ----------------------------------------------------------------------------

echo "Fetching PR data..."
PR_DATA=$(gh api "repos/:owner/:repo/pulls/${PR_NUMBER}")

# Extract metrics
ADDITIONS=$(echo "$PR_DATA" | jq -r '.additions')
DELETIONS=$(echo "$PR_DATA" | jq -r '.deletions')
CHANGED_FILES=$(echo "$PR_DATA" | jq -r '.changed_files')
COMMITS=$(echo "$PR_DATA" | jq -r '.commits')

echo "PR Metrics from GitHub API:"
echo "  Additions: ${ADDITIONS}"
echo "  Deletions: ${DELETIONS}"
echo "  Changed files: ${CHANGED_FILES}"
echo "  Commits: ${COMMITS}"

# Handle empty PR
if [ "$COMMITS" -eq 0 ]; then
  echo "⚠️  PR has no commits, skipping review"
  echo "should_skip=true" >> $GITHUB_OUTPUT
  echo "max_turns=30" >> $GITHUB_OUTPUT
  echo "is_rereview=false" >> $GITHUB_OUTPUT
  echo "previous_state=none" >> $GITHUB_OUTPUT
  echo "previous_was_approved=false" >> $GITHUB_OUTPUT
  echo "complexity=empty" >> $GITHUB_OUTPUT
  echo "total_changes=0" >> $GITHUB_OUTPUT
  echo "changed_files=0" >> $GITHUB_OUTPUT
  exit 0
fi

# ----------------------------------------------------------------------------
# 2. DETECT TRIVIAL PRs (Pure Merges/Rebases)
# ----------------------------------------------------------------------------

echo ""
echo "Checking for trivial PRs (pure merges/rebases)..."

# Fetch all commits in PR
COMMITS_DATA=$(gh api "repos/:owner/:repo/pulls/${PR_NUMBER}/commits")

# Check if ALL commits are merge commits (have 2+ parents)
MERGE_COMMIT_COUNT=$(echo "$COMMITS_DATA" | jq '[.[] | select(.parents | length >= 2)] | length')
TOTAL_COMMITS=$(echo "$COMMITS_DATA" | jq 'length')

echo "  Merge commits: ${MERGE_COMMIT_COUNT} / ${TOTAL_COMMITS}"

# Calculate actual code changes (exclude merge commit metadata)
# Use git diff to get actual changes between base and head
echo "  Fetching base branch for diff..."
git fetch origin "${BASE_REF}" --depth=50 2>/dev/null || {
  echo "⚠️  Git fetch failed, will fallback to GitHub API stats"
}

# Try to get actual diff stats
ACTUAL_ADDITIONS="$ADDITIONS"
ACTUAL_DELETIONS="$DELETIONS"

if git diff --shortstat "origin/${BASE_REF}...${HEAD_SHA}" 2>/dev/null; then
  DIFF_OUTPUT=$(git diff --shortstat "origin/${BASE_REF}...${HEAD_SHA}")
  if [ -n "$DIFF_OUTPUT" ]; then
    # Use sed instead of grep -P for portability
    ACTUAL_ADDITIONS=$(echo "$DIFF_OUTPUT" | sed -n 's/.*\([0-9][0-9]*\) insertion.*/\1/p')
    ACTUAL_DELETIONS=$(echo "$DIFF_OUTPUT" | sed -n 's/.*\([0-9][0-9]*\) deletion.*/\1/p')
    # Default to 0 if sed didn't match
    ACTUAL_ADDITIONS=${ACTUAL_ADDITIONS:-0}
    ACTUAL_DELETIONS=${ACTUAL_DELETIONS:-0}
    echo "  Actual changes from git diff: +${ACTUAL_ADDITIONS} -${ACTUAL_DELETIONS}"
  else
    echo "  No diff output, using API stats"
  fi
else
  echo "  Git diff failed, using API stats: +${ACTUAL_ADDITIONS} -${ACTUAL_DELETIONS}"
fi

# Validate numeric values
if ! [[ "$ACTUAL_ADDITIONS" =~ ^[0-9]+$ ]]; then ACTUAL_ADDITIONS="$ADDITIONS"; fi
if ! [[ "$ACTUAL_DELETIONS" =~ ^[0-9]+$ ]]; then ACTUAL_DELETIONS="$DELETIONS"; fi

TOTAL_ACTUAL_CHANGES=$((ACTUAL_ADDITIONS + ACTUAL_DELETIONS))
echo "  Total actual changes: ${TOTAL_ACTUAL_CHANGES} lines"

# Determine if PR should be skipped
SHOULD_SKIP="false"

# Skip if: All commits are merge commits AND actual changes < 50 lines
if [ "$MERGE_COMMIT_COUNT" -eq "$TOTAL_COMMITS" ] && [ "$MERGE_COMMIT_COUNT" -gt 0 ]; then
  if [ "$TOTAL_ACTUAL_CHANGES" -lt 50 ]; then
    echo "✓ Trivial PR detected: Pure merge with <50 line changes"
    SHOULD_SKIP="true"
  fi
fi

# Skip pure rebase commits (0 actual changes)
if [ "$ACTUAL_ADDITIONS" -eq 0 ] && [ "$ACTUAL_DELETIONS" -eq 0 ]; then
  echo "✓ Trivial PR detected: Pure rebase with 0 changes"
  SHOULD_SKIP="true"
fi

if [ "$SHOULD_SKIP" = "false" ]; then
  echo "  Not a trivial PR, will proceed with review"
fi

# ----------------------------------------------------------------------------
# 3. CALCULATE PR COMPLEXITY → MAX_TURNS
# ----------------------------------------------------------------------------

echo ""
echo "Calculating PR complexity..."

# Use GitHub API stats for complexity calculation (represents full PR scope)
# Git diff is only used for trivial PR detection (merge/rebase detection)
TOTAL_CHANGES=$((ADDITIONS + DELETIONS))
MAX_TURNS=30  # Default
COMPLEXITY="complex"

# Complexity thresholds:
# - Simple: <100 lines AND <5 files → 25 turns
# - Medium: <250 lines AND <8 files → 20 turns
# - Complex: >=250 lines OR >=8 files → 30 turns

if [ "$TOTAL_CHANGES" -lt 100 ] && [ "$CHANGED_FILES" -lt 5 ]; then
  MAX_TURNS=25
  COMPLEXITY="simple"
  echo "  Classification: SIMPLE (<100 lines AND <5 files)"
elif [ "$TOTAL_CHANGES" -lt 250 ] && [ "$CHANGED_FILES" -lt 8 ]; then
  MAX_TURNS=20
  COMPLEXITY="medium"
  echo "  Classification: MEDIUM (<250 lines AND <8 files)"
else
  MAX_TURNS=30
  COMPLEXITY="complex"
  echo "  Classification: COMPLEX (≥250 lines OR ≥8 files)"
fi

echo "  Max turns: ${MAX_TURNS}"

# Validate max_turns
if ! [[ "$MAX_TURNS" =~ ^[0-9]+$ ]]; then
  echo "⚠️  Invalid max_turns, using default"
  MAX_TURNS=30
fi

# ----------------------------------------------------------------------------
# 4. CHECK PREVIOUS REVIEW STATUS
# ----------------------------------------------------------------------------

echo ""
echo "Checking previous review status..."

# Get all reviews sorted by submission time (newest first)
REVIEWS=$(gh api "repos/:owner/:repo/pulls/${PR_NUMBER}/reviews" --jq 'sort_by(.submitted_at) | reverse')

# Get most recent review state from github-actions bot
PREVIOUS_STATE=$(echo "$REVIEWS" | jq -r '[.[] | select(.user.login == "github-actions[bot]")] | .[0].state // "none"')
PREVIOUS_WAS_APPROVED="false"

if [ "$PREVIOUS_STATE" = "APPROVED" ]; then
  PREVIOUS_WAS_APPROVED="true"
  echo "  Previous review: APPROVED"
elif [ "$PREVIOUS_STATE" = "none" ]; then
  echo "  Previous review: none (first review)"
else
  echo "  Previous review: ${PREVIOUS_STATE}"
fi

# Check if this is a re-review (new commits since last review)
IS_REREVIEW="false"
if [ "$PREVIOUS_STATE" != "none" ]; then
  # Get the commit SHA that was reviewed last time
  LAST_REVIEW_COMMIT=$(echo "$REVIEWS" | jq -r '[.[] | select(.user.login == "github-actions[bot]")] | .[0].commit_id // ""')
  if [ -n "$LAST_REVIEW_COMMIT" ] && [ "$LAST_REVIEW_COMMIT" != "null" ]; then
    # Compare with current HEAD SHA
    if [ "$LAST_REVIEW_COMMIT" != "$HEAD_SHA" ]; then
      IS_REREVIEW="true"
      echo "  Re-review detected: new commits since last review"
      echo "    Last reviewed commit: ${LAST_REVIEW_COMMIT:0:8}"
      echo "    Current commit: ${HEAD_SHA:0:8}"
    else
      echo "  Same commit as last review, not a re-review"
    fi
  else
    # Fallback: If commit_id not available, check date comparison
    # Note: ISO 8601 dates are lexicographically comparable (YYYY-MM-DDTHH:MM:SSZ format)
    LAST_REVIEW_DATE=$(echo "$REVIEWS" | jq -r '[.[] | select(.user.login == "github-actions[bot]")] | .[0].submitted_at // ""')
    if [ -n "$LAST_REVIEW_DATE" ]; then
      LAST_UPDATED=$(echo "$PR_DATA" | jq -r '.updated_at')
      if [[ "$LAST_UPDATED" > "$LAST_REVIEW_DATE" ]]; then
        IS_REREVIEW="true"
        echo "  Re-review detected: PR updated after last review (using date fallback)"
        echo "    Last review: ${LAST_REVIEW_DATE}"
        echo "    Last updated: ${LAST_UPDATED}"
      fi
    fi
  fi
fi

# ----------------------------------------------------------------------------
# 5. OUTPUT TO GITHUB_OUTPUT
# ----------------------------------------------------------------------------

echo ""
echo "============================================================================"
echo "Analysis Results:"
echo "============================================================================"
echo "  should_skip: ${SHOULD_SKIP}"
echo "  max_turns: ${MAX_TURNS}"
echo "  complexity: ${COMPLEXITY}"
echo "  is_rereview: ${IS_REREVIEW}"
echo "  previous_state: ${PREVIOUS_STATE}"
echo "  previous_was_approved: ${PREVIOUS_WAS_APPROVED}"
echo "  total_changes: ${TOTAL_CHANGES}"
echo "  changed_files: ${CHANGED_FILES}"
echo "============================================================================"

echo "should_skip=${SHOULD_SKIP}" >> $GITHUB_OUTPUT
echo "max_turns=${MAX_TURNS}" >> $GITHUB_OUTPUT
echo "is_rereview=${IS_REREVIEW}" >> $GITHUB_OUTPUT
echo "previous_state=${PREVIOUS_STATE}" >> $GITHUB_OUTPUT
echo "previous_was_approved=${PREVIOUS_WAS_APPROVED}" >> $GITHUB_OUTPUT
echo "complexity=${COMPLEXITY}" >> $GITHUB_OUTPUT
echo "total_changes=${TOTAL_CHANGES}" >> $GITHUB_OUTPUT
echo "changed_files=${CHANGED_FILES}" >> $GITHUB_OUTPUT

echo ""
echo "✓ Analysis complete"
