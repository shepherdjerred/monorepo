#!/opt/homebrew/bin/bash
# Benchmark rules_bun performance across cache tiers and target sizes.
# Controls for confounding variables (analysis cache, disk cache, thermal throttling).
#
# Usage:
#   bench-rules-bun.sh              # Full matrix
#   bench-rules-bun.sh --quick      # Just small: warm + bun baseline
#   bench-rules-bun.sh --no-cold    # Skip truly cold tier
set -euo pipefail

export PATH="$HOME/.local/share/mise/shims:$PATH"
BAZEL=$(command -v bazelisk 2>/dev/null || command -v bazel 2>/dev/null) || {
    echo "Neither bazelisk nor bazel found on PATH"; exit 1
}

cd "$(git rev-parse --show-toplevel)"

# --- Configuration ---
SMALL_BAZEL="//packages/eslint-config:lint"
SMALL_TREE="//packages/eslint-config:tree"
SMALL_BUN_DIR="packages/eslint-config"
SMALL_TOUCH="packages/eslint-config/src/index.ts"
SMALL_LABEL="eslint-cfg"

MEDIUM_BAZEL="//packages/scout-for-lol/packages/report:lint"
MEDIUM_TREE="//packages/scout-for-lol/packages/report:tree"
MEDIUM_BUN_DIR="packages/scout-for-lol/packages/report"
MEDIUM_TOUCH="packages/scout-for-lol/packages/report/src/index.ts"
MEDIUM_LABEL="scout/report"

LARGE_BAZEL="//packages/birmel:lint"
LARGE_TREE="//packages/birmel:tree"
LARGE_BUN_DIR="packages/birmel"
LARGE_TOUCH="packages/birmel/src/index.ts"
LARGE_LABEL="birmel"

DISK_CACHE="$HOME/.cache/bazel-disk"
LOGFILE="$HOME/.cache/rules-bun-bench-$(date +%Y-%m-%d_%H%M).log"
COOLDOWN=5

# --- Parse args ---
QUICK=false
NO_COLD=false
for arg in "$@"; do
    case "$arg" in
        --quick) QUICK=true ;;
        --no-cold) NO_COLD=true ;;
        *) echo "Unknown arg: $arg"; exit 1 ;;
    esac
done

# --- Helpers ---
now_ms() {
    # Millisecond timestamp (macOS-compatible via perl)
    perl -MTime::HiRes=time -e 'printf "%d\n", time()*1000'
}

time_ms() {
    # Run command, return wall time in milliseconds. Output goes to log.
    local start end
    start=$(now_ms)
    "$@" >>"$LOGFILE" 2>&1 || true
    end=$(now_ms)
    echo "$(( end - start ))"
}

format_time() {
    # Convert ms to human-readable
    local ms=$1
    if [ "$ms" -ge 60000 ]; then
        printf "%dm%ds" "$(( ms / 60000 ))" "$(( (ms % 60000) / 1000 ))"
    elif [ "$ms" -ge 1000 ]; then
        printf "%.1fs" "$(echo "scale=1; $ms / 1000" | bc)"
    else
        printf "%dms" "$ms"
    fi
}

median_of_3() {
    # Run command 3 times, return median ms
    local t1 t2 t3
    t1=$(time_ms "$@")
    t2=$(time_ms "$@")
    t3=$(time_ms "$@")
    # Sort and take middle
    echo "$t1 $t2 $t3" | tr ' ' '\n' | sort -n | sed -n '2p'
}

pad() {
    # Right-pad string to width
    printf "%-${2}s" "$1"
}

rpad() {
    # Left-pad string to width
    printf "%${2}s" "$1"
}

ratio() {
    # Compute ratio as Nx string
    local bazel=$1 bun=$2
    if [ "$bun" -eq 0 ]; then echo "N/A"; return; fi
    printf "%.0fx" "$(echo "scale=1; $bazel / $bun" | bc)"
}

# --- Results storage ---
declare -A RESULTS

run_tier() {
    local size=$1 tier=$2 target=$3 tree=$4 touch_file=$5 bun_dir=$6

    case "$tier" in
        bun)
            echo "  [$size] Native bun (3 runs)..."
            RESULTS["${size}_bun"]=$(median_of_3 bash -c "cd $bun_dir && bunx eslint . --no-error-on-unmatched-pattern")
            ;;
        warm)
            # Ensure target is built first
            time_ms "$BAZEL" test "$target" --noprofile >/dev/null 2>&1 || true
            echo "  [$size] Warm (3 runs)..."
            RESULTS["${size}_warm"]=$(median_of_3 "$BAZEL" test "$target" --noprofile)
            ;;
        incremental)
            echo "  [$size] Incremental (touch + rebuild)..."
            touch "$touch_file"
            RESULTS["${size}_incr"]=$(time_ms "$BAZEL" test "$target" --noprofile)
            ;;
        clean)
            echo "  [$size] Clean outputs..."
            "$BAZEL" clean >>"$LOGFILE" 2>&1 || true
            sleep "$COOLDOWN"
            RESULTS["${size}_clean"]=$(time_ms "$BAZEL" test "$target" --noprofile)
            ;;
        cold_server)
            echo "  [$size] Cold server (shutdown, disk cache intact)..."
            "$BAZEL" shutdown >>"$LOGFILE" 2>&1 || true
            sleep "$COOLDOWN"
            RESULTS["${size}_cold"]=$(time_ms "$BAZEL" test "$target" --noprofile)
            ;;
        truly_cold)
            echo "  [$size] Truly cold (shutdown + clear disk cache)..."
            "$BAZEL" shutdown >>"$LOGFILE" 2>&1 || true
            rm -rf "$DISK_CACHE"
            if command -v purge >/dev/null 2>&1; then
                sudo purge 2>/dev/null || true
            fi
            sleep "$COOLDOWN"
            RESULTS["${size}_truly_cold"]=$(time_ms "$BAZEL" test "$target" --noprofile)
            ;;
    esac
}

run_size() {
    local size=$1 target=$2 tree=$3 touch_file=$4 bun_dir=$5

    if $QUICK && [ "$size" != "small" ]; then
        return
    fi

    echo ""
    echo "--- $size ---"

    # Order: bun first (no Bazel interference), then warm→incremental→clean→cold
    run_tier "$size" bun "$target" "$tree" "$touch_file" "$bun_dir"
    run_tier "$size" warm "$target" "$tree" "$touch_file" "$bun_dir"

    if ! $QUICK; then
        run_tier "$size" incremental "$target" "$tree" "$touch_file" "$bun_dir"
        run_tier "$size" clean "$target" "$tree" "$touch_file" "$bun_dir"
        run_tier "$size" cold_server "$target" "$tree" "$touch_file" "$bun_dir"
        if ! $NO_COLD; then
            run_tier "$size" truly_cold "$target" "$tree" "$touch_file" "$bun_dir"
        fi
    fi
}

# --- Main ---
echo "rules_bun Benchmark"
echo "$(date)"
echo "Log: $LOGFILE"
echo ""

# Prerequisites
echo "Building eslint-config..."
(cd packages/eslint-config && bun run build) >>"$LOGFILE" 2>&1 || {
    echo "  WARNING: eslint-config build failed (may affect bun lint baselines)"
}

# Warm Bazel server
echo "Warming Bazel server..."
"$BAZEL" info >>"$LOGFILE" 2>&1 || true

# Run matrix
run_size small "$SMALL_BAZEL" "$SMALL_TREE" "$SMALL_TOUCH" "$SMALL_BUN_DIR"
run_size medium "$MEDIUM_BAZEL" "$MEDIUM_TREE" "$MEDIUM_TOUCH" "$MEDIUM_BUN_DIR"
run_size large "$LARGE_BAZEL" "$LARGE_TREE" "$LARGE_TOUCH" "$LARGE_BUN_DIR"

# --- Print results ---
echo ""
echo ""
echo "rules_bun Benchmark Results ($(date '+%Y-%m-%d %H:%M'))"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Header
printf "%-28s" ""
rpad "$SMALL_LABEL" 15
rpad "$MEDIUM_LABEL" 15
rpad "$LARGE_LABEL" 15
echo ""

printf "%-28s" ""
rpad "─────────" 15
rpad "─────────" 15
rpad "─────────" 15
echo ""

# Rows
print_row() {
    local label=$1 small_key=$2 medium_key=$3 large_key=$4
    printf "%-28s" "$label"

    if [ -n "${RESULTS[$small_key]+x}" ]; then
        rpad "$(format_time "${RESULTS[$small_key]}")" 15
    else
        rpad "-" 15
    fi

    if [ -n "${RESULTS[$medium_key]+x}" ]; then
        rpad "$(format_time "${RESULTS[$medium_key]}")" 15
    else
        rpad "-" 15
    fi

    if [ -n "${RESULTS[$large_key]+x}" ]; then
        rpad "$(format_time "${RESULTS[$large_key]}")" 15
    else
        rpad "-" 15
    fi

    echo ""
}

print_row "Native bun (baseline)" "small_bun" "medium_bun" "large_bun"
echo ""
print_row "Bazel warm (cached)" "small_warm" "medium_warm" "large_warm"
print_row "Bazel incremental" "small_incr" "medium_incr" "large_incr"
print_row "Bazel clean outputs" "small_clean" "medium_clean" "large_clean"
print_row "Bazel cold server" "small_cold" "medium_cold" "large_cold"
if ! $NO_COLD; then
    print_row "Bazel truly cold" "small_truly_cold" "medium_truly_cold" "large_truly_cold"
fi

# Ratios
echo ""
printf "%-28s" ""
rpad "─────────" 15
rpad "─────────" 15
rpad "─────────" 15
echo ""

print_ratio_row() {
    local label=$1 bazel_key=$2
    printf "%-28s" "$label"

    for size in small medium large; do
        local bun_val="${RESULTS[${size}_bun]:-0}"
        local bazel_val="${RESULTS[${size}_${bazel_key}]:-0}"
        if [ "$bun_val" -gt 0 ] && [ "$bazel_val" -gt 0 ]; then
            rpad "$(ratio "$bazel_val" "$bun_val")" 15
        else
            rpad "-" 15
        fi
    done
    echo ""
}

if [ -n "${RESULTS[small_cold]+x}" ]; then
    print_ratio_row "Ratio (cold/bun)" "cold"
fi
if [ -n "${RESULTS[small_warm]+x}" ]; then
    print_ratio_row "Ratio (warm/bun)" "warm"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Log: $LOGFILE"
echo "Profile: ~/.cache/bazel-profile.gz"
echo ""

# Save results
cp /dev/stdin "$HOME/.cache/rules-bun-bench-latest.txt" <<EOF 2>/dev/null || true
$(for key in "${!RESULTS[@]}"; do echo "$key=${RESULTS[$key]}"; done | sort)
EOF

echo "Results saved to $HOME/.cache/rules-bun-bench-latest.txt"
