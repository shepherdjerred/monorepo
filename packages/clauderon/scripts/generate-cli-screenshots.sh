#!/usr/bin/env bash
# Generate SVG screenshots of CLI output for documentation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCREENSHOTS_DIR="$PROJECT_DIR/screenshots/cli"

# Create output directory
mkdir -p "$SCREENSHOTS_DIR"

# Function to convert terminal output to SVG with ANSI color support
# Usage: generate_svg "command" "output.svg"
generate_svg() {
    local command=$1
    local output_file=$2
    local temp_file=$(mktemp)
    local temp_html=$(mktemp)

    echo "Generating $output_file..."

    # Capture command output with ANSI codes
    eval "$command" 2>&1 > "$temp_file"

    # Convert ANSI to SVG using Python
    python3 - "$temp_file" "$SCREENSHOTS_DIR/$output_file" <<'PYTHON'
import sys
import re
import html

# ANSI color mappings (standard terminal colors)
ANSI_COLORS = {
    '30': '#000000',  # Black
    '31': '#CD3131',  # Red
    '32': '#0DBC79',  # Green
    '33': '#E5E512',  # Yellow
    '34': '#2472C8',  # Blue
    '35': '#BC3FBC',  # Magenta
    '36': '#11A8CD',  # Cyan
    '37': '#E5E5E5',  # White
    '90': '#666666',  # Bright Black (Gray)
    '91': '#F14C4C',  # Bright Red
    '92': '#23D18B',  # Bright Green
    '93': '#F5F543',  # Bright Yellow
    '94': '#3B8EEA',  # Bright Blue
    '95': '#D670D6',  # Bright Magenta
    '96': '#29B8DB',  # Bright Cyan
    '97': '#E5E5E5',  # Bright White
}

DEFAULT_FG = '#D4D4D4'
DEFAULT_BG = '#1E1E1E'

def parse_ansi(text):
    """Parse ANSI escape sequences and return list of (text, color) tuples."""
    parts = []
    current_color = DEFAULT_FG

    # Split by ANSI escape sequences
    ansi_pattern = r'\x1b\[([0-9;]+)m'
    pos = 0

    for match in re.finditer(ansi_pattern, text):
        # Add text before this escape sequence
        if match.start() > pos:
            chunk = text[pos:match.start()]
            if chunk:
                parts.append((chunk, current_color))

        # Parse the escape sequence
        codes = match.group(1).split(';')
        for code in codes:
            if code == '0' or code == '':
                current_color = DEFAULT_FG
            elif code in ANSI_COLORS:
                current_color = ANSI_COLORS[code]
            elif code == '1':  # Bold - keep current color
                pass

        pos = match.end()

    # Add remaining text
    if pos < len(text):
        chunk = text[pos:]
        if chunk:
            parts.append((chunk, current_color))

    return parts

def create_svg(input_file, output_file):
    with open(input_file, 'r') as f:
        lines = f.readlines()

    # Calculate dimensions
    max_width = max(len(line.rstrip('\n')) for line in lines) if lines else 80
    line_count = len(lines)

    char_width = 8
    line_height = 20
    padding = 20

    svg_width = max(400, max_width * char_width + padding * 2)
    svg_height = max(100, line_count * line_height + padding * 2)

    # Start SVG
    svg_parts = []
    svg_parts.append(f'''<?xml version="1.0" encoding="UTF-8"?>
<svg width="{svg_width}" height="{svg_height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .terminal {{
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Droid Sans Mono', 'Source Code Pro', monospace;
      font-size: 14px;
      white-space: pre;
    }}
  </style>
  <rect width="100%" height="100%" fill="{DEFAULT_BG}" rx="6"/>
''')

    # Add lines
    y = padding + 14
    for line in lines:
        line = line.rstrip('\n')
        parts = parse_ansi(line)

        if not parts:
            y += line_height
            continue

        svg_parts.append(f'  <text class="terminal" y="{y}">\n')

        x_offset = padding
        for text, color in parts:
            # Escape XML and preserve spaces
            escaped_text = html.escape(text)
            svg_parts.append(f'    <tspan x="{x_offset}" fill="{color}">{escaped_text}</tspan>')
            x_offset += len(text) * char_width

        svg_parts.append('  </text>\n')
        y += line_height

    svg_parts.append('</svg>\n')

    with open(output_file, 'w') as f:
        f.write(''.join(svg_parts))

if __name__ == '__main__':
    create_svg(sys.argv[1], sys.argv[2])
PYTHON

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
