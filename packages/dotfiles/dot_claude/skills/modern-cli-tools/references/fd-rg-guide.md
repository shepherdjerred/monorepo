# fd & rg (ripgrep) Reference Guide

## fd - Modern Find

### Basic Usage

```bash
# Find files by name (case-insensitive by default)
fd readme

# Find with extension
fd -e md
fd -e js -e ts

# Find in specific directory
fd pattern ~/projects

# Find directories only
fd -t d config

# Find files only
fd -t f

# Find hidden files
fd -H config

# Exclude patterns
fd -E node_modules -E .git

# Execute command on results
fd -e jpg -x convert {} {.}.png
```

### Advanced Patterns

```bash
# Regex search
fd '^[A-Z].*\.md$'

# Show full path
fd -p src/components

# Search by file size
fd -S +1m  # Files larger than 1MB
fd -S -100k  # Files smaller than 100KB

# Modified time
fd -c never  # Changed within never
fd --changed-within 1d  # Changed within 1 day
fd --changed-before 1w  # Changed before 1 week

# Case sensitive
fd -s README

# Max depth
fd -d 3 config
```

### Common Use Cases

```bash
# Find all TypeScript files excluding node_modules
fd -e ts -E node_modules

# Find config files
fd -g '*config*'

# Find and delete empty directories
fd -t d -x sh -c 'rmdir {} 2>/dev/null'

# List all test files
fd test -e ts -e js

# Find large log files
fd -e log -S +100m
```

## rg (ripgrep) - Modern Grep

### Basic Usage

```bash
# Search for pattern
rg "TODO"

# Case insensitive
rg -i "readme"

# Whole word match
rg -w "config"

# Show line numbers (default)
rg "error"

# Show context (3 lines before and after)
rg -C 3 "function"

# Search specific file types
rg -t ts "interface"
rg -t md "# Heading"

# Exclude file types
rg -T js "pattern"

# Search hidden files
rg -. "secret"

# Search without ignoring (.gitignore)
rg -u "pattern"
```

### Advanced Patterns

```bash
# Regex search
rg '^\s*function\s+\w+'

# Multiple patterns (OR)
rg -e "error" -e "warning"

# Invert match (show non-matching lines)
rg -v "test"

# Count matches
rg -c "import"

# Show only filenames
rg -l "TODO"

# Show only matching parts
rg -o '\b[A-Z]{3,}\b'

# Replace (preview only)
rg "old" -r "new"

# Multiline search
rg -U 'function.*\{.*\}'
```

### Common Use Cases

```bash
# Find all TODOs in code
rg "TODO|FIXME|HACK"

# Find imports of a specific module
rg "import.*from.*'react'"

# Find function definitions
rg "function\s+\w+\s*\("

# Search in specific directories
rg "API_KEY" src/

# Find unused exports
rg -w "export" | rg -v "import"

# Case-insensitive search in markdown files
rg -i -t md "claude code"

# Find potential secrets (be careful!)
rg -i "(password|secret|api[_-]?key)\s*[:=]"

# Search git history
rg --no-ignore --hidden "sensitive_data"
```
