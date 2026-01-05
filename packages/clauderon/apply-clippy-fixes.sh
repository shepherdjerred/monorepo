#!/usr/bin/env bash
set -euo pipefail

# Script to apply clippy fixes for the 39 enabled lints
# Run this locally where cargo has proper permissions

echo "====================================================="
echo "Applying Clippy Fixes for Clauderon"
echo "====================================================="
echo ""

# Navigate to clauderon directory
cd "$(dirname "$0")"

# Check if we're in the right directory
if [[ ! -f "Cargo.toml" ]]; then
    echo "Error: Cargo.toml not found. Are you in the clauderon directory?"
    exit 1
fi

# Backup current state
echo "Step 1: Creating backup..."
git stash push -m "Backup before applying clippy fixes"
BACKUP_STASH=$(git stash list | head -n 1 | cut -d: -f1)
echo "✓ Backup created: $BACKUP_STASH"
echo ""

# Apply automated fixes
echo "Step 2: Running cargo clippy --fix..."
echo "This will automatically fix ~100-150 violations..."
echo ""

if cargo clippy --fix --allow-dirty --allow-staged; then
    echo ""
    echo "✓ Automated fixes applied successfully!"
else
    echo ""
    echo "⚠ Clippy fix completed with some errors (this is normal)"
fi

echo ""
echo "Step 3: Checking remaining violations..."
echo ""

# Check for remaining issues
cargo clippy -- -D warnings 2>&1 | tee clippy-remaining.log || true

echo ""
echo "====================================================="
echo "Summary"
echo "====================================================="
echo ""
echo "Automated fixes have been applied to your source files."
echo ""
echo "Next steps:"
echo "1. Review changes: git diff"
echo "2. Check remaining violations: cat clippy-remaining.log"
echo "3. Fix remaining violations manually (see CLIPPY_LINTS_ENABLED.md)"
echo "4. Run tests: cargo test --all-targets"
echo "5. Commit changes: git add -A && git commit"
echo ""
echo "If you need to rollback:"
echo "  git stash pop $BACKUP_STASH"
echo ""
echo "====================================================="
