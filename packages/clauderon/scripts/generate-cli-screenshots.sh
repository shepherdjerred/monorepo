#!/usr/bin/env bash
# Generate SVG screenshots of CLI output for documentation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCREENSHOTS_DIR="$PROJECT_DIR/screenshots/cli"

# Colors for terminal output in SVG
FG_COLOR="#D4D4D4"
BG_COLOR="#1E1E1E"
FONT_FAMILY="'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Droid Sans Mono', 'Source Code Pro', monospace"

# Create output directory
mkdir -p "$SCREENSHOTS_DIR"

# Function to convert terminal output to SVG
# Usage: generate_svg "command" "output.svg"
generate_svg() {
    local command=$1
    local output_file=$2
    local temp_file=$(mktemp)

    echo "Generating $output_file..."

    # Capture command output (with ANSI codes stripped for now)
    # We'll use a simple approach without ANSI processing for POC
    eval "$command" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' > "$temp_file"

    # Calculate SVG dimensions based on content
    local line_count=$(wc -l < "$temp_file")
    local max_width=$(awk '{print length}' "$temp_file" | sort -n | tail -1)

    # SVG dimensions (character-based)
    local char_width=8
    local line_height=20
    local padding=20

    local svg_width=$((max_width * char_width + padding * 2))
    local svg_height=$((line_count * line_height + padding * 2))

    # Ensure minimum dimensions
    [[ $svg_width -lt 400 ]] && svg_width=400
    [[ $svg_height -lt 100 ]] && svg_height=100

    # Generate SVG
    cat > "$SCREENSHOTS_DIR/$output_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<svg width="$svg_width" height="$svg_height" xmlns="http://www.w3.org/2000/svg">
  <style>
    .terminal {
      font-family: $FONT_FAMILY;
      font-size: 14px;
      line-height: ${line_height}px;
    }
  </style>

  <rect width="100%" height="100%" fill="$BG_COLOR" rx="6"/>

  <text class="terminal" fill="$FG_COLOR" x="$padding" y="$((padding + 14))">
EOF

    # Add each line as a tspan element with absolute y positions
    local y=$((padding + 14))
    local first_line=true
    while IFS= read -r line; do
        # Escape XML special characters
        line=$(echo "$line" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g')
        if [ "$first_line" = true ]; then
            echo "    <tspan x=\"$padding\" y=\"$y\">${line}</tspan>" >> "$SCREENSHOTS_DIR/$output_file"
            first_line=false
        else
            echo "    <tspan x=\"$padding\" y=\"$y\">${line}</tspan>" >> "$SCREENSHOTS_DIR/$output_file"
        fi
        y=$((y + line_height))
    done < "$temp_file"

    cat >> "$SCREENSHOTS_DIR/$output_file" <<EOF
  </text>
</svg>
EOF

    rm "$temp_file"
    echo "✓ Created $output_file"
}

# Find clauderon binary
echo "Looking for clauderon binary..."
cd "$PROJECT_DIR"

CLAUDERON=""
if [[ -f "$PROJECT_DIR/target/release/clauderon" ]]; then
    CLAUDERON="$PROJECT_DIR/target/release/clauderon"
    echo "Using release binary: $CLAUDERON"
elif [[ -f "$PROJECT_DIR/target/debug/clauderon" ]]; then
    CLAUDERON="$PROJECT_DIR/target/debug/clauderon"
    echo "Using debug binary: $CLAUDERON"
else
    echo "ERROR: clauderon binary not found!"
    echo "Please build first with: cargo build --release"
    exit 1
fi

echo ""
echo "Generating CLI screenshots from REAL application..."
echo "=============================="
echo ""

# Generate screenshots from ACTUAL clauderon commands
generate_svg "$CLAUDERON --help" "clauderon-help.svg"
generate_svg "$CLAUDERON list" "clauderon-list.svg"
generate_svg "$CLAUDERON create --help" "clauderon-create-help.svg"

echo ""
echo "✓ All CLI screenshots generated in $SCREENSHOTS_DIR"
echo ""
ls -lh "$SCREENSHOTS_DIR"
