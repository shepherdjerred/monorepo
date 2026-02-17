# Fish Syntax Reference

## Variables

### Setting Variables

Use `set` to create and modify variables. Fish has no `VAR=value` assignment syntax.

```fish
set name "Alice"
set count 42
set empty_list
```

### Variable Expansion

Access variables with the `$` prefix. Separate variable names from adjacent text with quotes or braces:

```fish
echo $name
echo "Hello, $name!"
echo "The {$name}s"        # brace separation
echo "The "$name"s"        # quote separation
```

### Variable Scopes

Fish provides four scoping levels, specified as flags to `set`:

| Flag | Scope     | Lifetime                        |
| ---- | --------- | ------------------------------- |
| `-l` | Local     | Current block only              |
| `-f` | Function  | Current function                |
| `-g` | Global    | Current shell session           |
| `-U` | Universal | All sessions, persisted to disk |

```fish
set -l temp "block-scoped"
set -g session_var "session-scoped"
set -U EDITOR vim    # persists across all fish instances and reboots
```

When no scope flag is given, `set` uses the narrowest existing scope for that variable name. If the variable does not exist, it creates it in function scope (inside a function) or global scope (outside).

### Exporting Variables

Export variables to child processes with `-x` (or `--export`). Combine with scope flags:

```fish
set -gx PATH /usr/local/bin $PATH    # global + exported
set -lx TEMP_VAR "for child only"    # local + exported
set -gxu MY_VAR                       # unexport with -u
```

By convention, exported variables use UPPERCASE names.

### Erasing Variables

```fish
set -e variable_name
set -eg GLOBAL_VAR       # erase global specifically
set -eU UNIVERSAL_VAR    # erase universal specifically
```

### Querying Variables

```fish
set -q variable_name           # returns 0 if set, 1 otherwise
set -q variable_name[2]        # check if second element exists

if set -q MY_VAR
    echo "MY_VAR is defined"
end
```

### Special Variables

| Variable        | Description                                       |
| --------------- | ------------------------------------------------- |
| `$status`       | Exit status of last command (like bash `$?`)      |
| `$pipestatus`   | List of exit statuses from last pipeline          |
| `$argv`         | Arguments to current function/script              |
| `$fish_pid`     | PID of the fish process (like bash `$$`)          |
| `$last_pid`     | PID of last backgrounded process (like bash `$!`) |
| `$PATH`         | Command search path                               |
| `$PWD`          | Current working directory                         |
| `$HOME`         | User home directory                               |
| `$USER`         | Current username                                  |
| `$HOSTNAME`     | System hostname                                   |
| `$fish_version` | Fish version string                               |
| `$fish_trace`   | Set to 1 to enable execution tracing              |
| `$SHLVL`        | Shell nesting level                               |

### PATH Variables

Variables with names ending in `PATH` receive special treatment -- they split and join on colons automatically:

```fish
set -gx MANPATH /usr/local/share/man /usr/share/man
echo "$MANPATH"       # /usr/local/share/man:/usr/share/man

set MYPATH "1:2:3"
echo $MYPATH          # 1 2 3 (split into list)
```

Use `fish_add_path` to prepend directories to `$PATH` persistently:

```fish
fish_add_path /usr/local/bin
fish_add_path ~/.cargo/bin
```

## Lists

All fish variables are lists. A variable holding a single value is a list of length 1.

### Creating Lists

```fish
set colors red green blue
set empty_list              # empty list (0 elements)
set single "just one"       # list of 1 element
```

### Indexing (1-based)

```fish
set list a b c d e
echo $list[1]       # a
echo $list[3]       # c
echo $list[-1]      # e (last element)
echo $list[-2]      # d (second-to-last)
```

### Slicing

```fish
echo $list[2..4]    # b c d
echo $list[3..]     # c d e (from 3 to end)
echo $list[..2]     # a b (from start to 2)
echo $list[-1..1]   # e d c b a (reversed)
```

### List Operations

```fish
# Count elements
count $list                  # 5

# Append
set -a list f g              # list is now a b c d e f g
set list $list "new item"    # equivalent

# Prepend
set -p list z                # z a b c d e f g

# Check if empty
if test (count $list) -eq 0
    echo "Empty list"
end

# Contains check
if contains blue $colors
    echo "Found blue"
end

# Index of element
set idx (contains -i green $colors)   # returns index or fails
```

### Cartesian Product

When combining a list variable with text, fish produces the Cartesian product:

```fish
set ext c h
echo file.$ext       # file.c file.h
echo {a,b}$ext       # ac ah bc bh
```

### Empty List Behavior

An empty variable expands to nothing (not an empty string):

```fish
set empty
echo prefix$empty suffix    # prints: prefixsuffix (one argument lost)
echo "prefix${empty}suffix" # prints: prefixsuffix
```

## Command Substitution

Capture command output with parentheses:

```fish
set files (ls)
set today (date +%Y-%m-%d)
echo "You are in $(pwd)"

# Inside double quotes, use $() form
set content "$(cat file.txt)"    # single string, preserves newlines
set lines (cat file.txt)          # list, split on newlines
```

Fish splits command substitution output on newlines by default (not whitespace like bash). To prevent splitting, use double quotes.

### Piping to String Split

For splitting on other delimiters:

```fish
set words (echo "a,b,c" | string split ",")   # a b c as list
```

## Piping and Redirections

### Pipes

```fish
command1 | command2           # stdout of cmd1 to stdin of cmd2
command1 2>| command2         # stderr of cmd1 to stdin of cmd2
command1 &| command2          # stdout+stderr of cmd1 to stdin of cmd2
```

### Output Redirections

```fish
command > file.txt            # write stdout to file (truncate)
command >> file.txt           # append stdout to file
command 2> errors.txt         # write stderr to file
command 2>> errors.txt        # append stderr to file
command &> all.txt            # stdout+stderr to file
command > /dev/null           # discard stdout
command &> /dev/null          # discard all output
```

### Input Redirection

```fish
command < input.txt
```

### File Descriptor Redirection

```fish
command 2>&1                  # stderr to stdout
command 1>&2                  # stdout to stderr
```

### No Heredocs

Fish does not support heredocs. Alternatives:

```fish
# Multi-line echo
echo "line 1
line 2
line 3" | command

# printf for precise control
printf '%s\n' "line 1" "line 2" "line 3" | command

# Or read from a temporary file
```

## Control Flow

### if / else if / else

Conditional execution based on command exit status (0 = true):

```fish
if test -f config.toml
    echo "Config found"
else if test -f config.yaml
    echo "YAML config found"
else
    echo "No config"
end
```

Combine conditions:

```fish
if test -f file.txt; and test -r file.txt
    echo "File exists and is readable"
end

# Or with && and ||
if test -d src && test -f src/main.rs
    echo "Rust project detected"
end
```

### test / [ ] Conditions

Fish supports `test` and `[` but NOT `[[`:

```fish
# File tests
test -e path        # exists
test -f path        # regular file
test -d path        # directory
test -L path        # symlink
test -r path        # readable
test -w path        # writable
test -x path        # executable
test -s path        # non-empty file

# String tests
test -n "$var"      # non-empty string
test -z "$var"      # empty string
test "$a" = "$b"    # string equality
test "$a" != "$b"   # string inequality

# Numeric tests
test "$n" -eq 5     # equal
test "$n" -ne 5     # not equal
test "$n" -gt 5     # greater than
test "$n" -ge 5     # greater or equal
test "$n" -lt 5     # less than
test "$n" -le 5     # less or equal

# Logical operators within test
test -f a -a -f b   # AND
test -f a -o -f b   # OR
test ! -f a         # NOT
```

Always quote variable expansions in test expressions to handle empty values:

```fish
# WRONG: breaks if $var is empty
if test $var = "value"

# CORRECT:
if test "$var" = "value"
```

### switch / case

Pattern matching with glob support:

```fish
switch $animal
case cat
    echo "Meow"
case 'dog' 'wolf'
    echo "Woof"
case '*.fish'
    echo "A fish file"
case '*'
    echo "Unknown"
end
```

No fallthrough between cases. The first matching case executes and control leaves the switch.

### for Loops

```fish
for file in *.txt
    echo "Processing $file"
end

for i in (seq 1 10)
    echo $i
end

for color in red green blue
    echo $color
end

for arg in $argv
    echo "Argument: $arg"
end
```

### while Loops

```fish
while test $count -gt 0
    echo $count
    set count (math $count - 1)
end

# Read lines from file
while read -l line
    echo ">> $line"
end < input.txt

# Read lines from command output
command | while read -l line
    echo $line
end
```

### Loop Control

```fish
for i in (seq 100)
    if test $i -eq 50
        break              # exit loop
    end
    if math "$i % 2" > /dev/null
        continue           # skip to next iteration
    end
    echo $i
end
```

### Logical Combiners

```fish
command1 && command2     # run cmd2 only if cmd1 succeeds
command1 || command2     # run cmd2 only if cmd1 fails
not command              # invert exit status

# Keyword forms (equivalent, lower precedence)
command1; and command2
command1; or command2
```

### begin / end Blocks

Group commands for redirection or scoping:

```fish
begin
    set -l temp_var "scoped"
    echo "inside: $temp_var"
end > output.txt
# temp_var not available here

# Brace syntax (Fish 4.1+)
{ echo line1; echo line2 } > output.txt
```

## String Builtin

The `string` command handles all string manipulation:

### string length

```fish
string length "hello"                   # 5
string length -V "emoji: 🐟"           # visible width: 9
```

### string sub

```fish
string sub -s 2 -l 3 "hello"           # ell
string sub -s -3 "hello"               # llo
string sub -e 3 "hello"                # hel
```

### string split / split0

```fish
string split "," "a,b,c"               # a\nb\nc (list)
string split -m 1 "," "a,b,c"          # a\nb,c (max 1 split)
string split -r -m 1 "/" "/a/b/c"      # /a/b\nc (right-to-left)
string split0 < null-delimited-input
```

### string join / join0

```fish
string join "," a b c                   # a,b,c
string join \n "line1" "line2"          # line1\nline2
string join0 a b c                      # null-byte separated
```

### string match

```fish
# Glob matching
string match "*.txt" "readme.txt"       # readme.txt
string match -v "*.log" $files          # exclude .log files

# Regex matching
string match -r '(\d+)\.(\d+)' "v1.23"
# Match: v1.23, Group 1: 1, Group 2: 23

string match -rg '(\w+)=(\w+)' "key=val"
# Groups only: key\nval

# Case-insensitive
string match -ri 'hello' "HELLO"

# All matches
string match -ra '\d+' "a1b2c3"        # 1\n2\n3
```

### string replace

```fish
string replace "old" "new" "the old text"         # the new text
string replace -a "o" "0" "foo boo"               # f00 b00
string replace -r '(\w+)' 'word:$1' "hello"       # word:hello
string replace -r '\s+' ' ' "too   many   spaces" # too many spaces
string replace -f "pattern" "new" $strings         # filter: only output changed
```

### string trim

```fish
string trim "  hello  "                 # hello
string trim -l "  hello  "             # "hello  "
string trim -r "  hello  "             # "  hello"
string trim -c "x" "xxxhelloxxx"       # hello
```

### string upper / lower

```fish
string upper "hello"                    # HELLO
string lower "HELLO"                    # hello
```

### string pad

```fish
string pad -w 10 "hello"               # "     hello"
string pad -w 10 -r "hello"            # "hello     "
string pad -w 10 -C "hello"            # "  hello   " (center, Fish 4.1+)
string pad -c 0 -w 5 42                # 00042
```

### string repeat

```fish
string repeat -n 3 "ab"                # ababab
string repeat -n 3 -m 5 "abc"          # abcab (max 5 chars)
```

### string escape / unescape

```fish
string escape "hello world"            # hello\ world
string escape --style=url "hello world" # hello%20world
string escape --style=var "my-var"     # my_2Dvar
string unescape "hello\\ world"        # hello world
```

### string shorten

```fish
string shorten -m 10 "a long string"   # a long st…
string shorten -m 10 -c "..." "long"   # long st...
```

### string collect

```fish
# Collapse multi-line output into single argument
echo -e "a\nb\nc" | string collect     # "a\nb\nc" as one argument
```

## Math Builtin

Evaluate arithmetic expressions:

```fish
math 2 + 2                   # 4
math "10 / 3"                # 3.333333
math "10 % 3"                # 1
math "2 ^ 10"                # 1024
math "floor(3.7)"            # 3
math "ceil(3.2)"             # 4
math "round(3.5)"            # 4
math "abs(-5)"               # 5
math "sqrt(144)"             # 12
math "sin(pi)"               # ~0
math "log2(1024)"            # 10
math "max(3, 7)"             # 7
math "min(3, 7)"             # 3
```

Use in variable assignment:

```fish
set result (math "$x + $y")
set hex (math --base=hex 255)   # 0xff
```

### Operators

| Operator                    | Description                |
| --------------------------- | -------------------------- |
| `+` `-` `*` `/`             | Basic arithmetic           |
| `%`                         | Modulo                     |
| `^`                         | Exponentiation             |
| `( )`                       | Grouping                   |
| `>` `<` `>=` `<=` `==` `!=` | Comparison (return 0 or 1) |

### Functions Available in math

`abs`, `acos`, `asin`, `atan`, `atan2`, `bitand`, `bitor`, `bitxor`, `ceil`, `cos`, `exp`, `fac`, `floor`, `ln`, `log`, `log2`, `log10`, `max`, `min`, `ncr`, `npr`, `pow`, `round`, `sin`, `sqrt`, `tan`

Constants: `pi`, `e`, `tau`, `inf`

## Exit Status

Every command returns an integer exit status (0 = success):

```fish
command_that_succeeds
echo $status              # 0

command_that_fails
echo $status              # non-zero

# Pipeline status
cat file | grep pattern | wc -l
echo $pipestatus          # list of all exit codes in pipeline
echo $pipestatus[2]       # grep's exit code specifically
```

### Return from Functions

```fish
function check_file
    if not test -f $argv[1]
        return 1
    end
    return 0
end
```

## Quoting Rules

### Single Quotes

Prevent all expansions. Only `\'` and `\\` are special inside single quotes:

```fish
echo 'No $expansion here'
echo 'Literal (parentheses)'
echo 'Use \'single quotes\' inside'
```

### Double Quotes

Allow variable expansion and command substitution. Prevent globbing and splitting:

```fish
echo "Hello $name"
echo "Current dir: $(pwd)"
echo "Literal \$dollar"
echo "List as one arg: $mylist"   # elements joined by space
```

### No Quotes

All expansions apply. Glob patterns match files. Variables expand to multiple arguments:

```fish
set list a b c
echo $list           # three arguments: a b c
echo *.txt           # matches files
echo \$literal       # escape special chars with backslash
```

### Escape Sequences (Outside Quotes)

| Sequence     | Result            |
| ------------ | ----------------- |
| `\\`         | Literal backslash |
| `\n`         | Newline           |
| `\t`         | Tab               |
| `\r`         | Carriage return   |
| `\xHH`       | Hex byte          |
| `\uXXXX`     | Unicode codepoint |
| `\UXXXXXXXX` | Extended Unicode  |
| `\a`         | Alert (bell)      |
| `\e`         | Escape character  |

## Wildcards and Globbing

```fish
ls *.txt              # all .txt files in current dir
ls **/*.rs            # recursive: all .rs files in any subdirectory
ls file?.txt          # ? matches single char (deprecated, use qmark-noglob)
ls {src,test}/*.fish  # brace expansion + glob
```

Hidden files (starting with `.`) are not matched unless the pattern explicitly starts with `.`:

```fish
ls .*                 # matches hidden files
ls *                  # does NOT match hidden files
```

If a glob matches nothing, the command fails with status 124 (unless used with `for`, `set`, or `count`).

## Brace Expansion

```fish
echo {a,b,c}         # a b c
echo file.{txt,md}   # file.txt file.md
cp file{,.bak}        # cp file file.bak
echo {1..5}           # NOT supported (use seq instead)
```

Braces require commas or variable expansion to trigger expansion. Literal braces without commas pass through unchanged.

## Practical Patterns

### String Processing Pipelines

```fish
# Extract field from colon-delimited line
echo "user:1000:group" | string split ":" | head -1

# Process CSV-like data
for line in (cat data.csv)
    set fields (string split "," $line)
    echo "Name: $fields[1], Age: $fields[2]"
end

# Remove file extensions
for f in *.tar.gz
    set base (string replace -r '\.tar\.gz$' '' $f)
    echo $base
end

# Validate email format
function is_email
    string match -rq '^[^@]+@[^@]+\.[^@]+$' $argv[1]
end
```

### Safe Variable Patterns

```fish
# Default values
set -q MY_PORT; or set MY_PORT 8080

# Coalesce: use first non-empty value
set -l result
for var in $PREFERRED $FALLBACK $DEFAULT
    if test -n "$var"
        set result $var
        break
    end
end

# Check variable is set and non-empty
if set -q var; and test -n "$var"
    echo "var is set and non-empty: $var"
end
```

### Error Handling

```fish
# Check command existence before use
if not command -sq jq
    echo "Error: jq is required but not installed" >&2
    return 1
end

# Capture stderr
set -l output (command 2>&1)
set -l code $status

# Die pattern
function die
    echo "Error: $argv" >&2
    return 1
end

test -f config.toml; or die "config.toml not found"
```

### Temporary File Patterns

```fish
# Create and clean up temp files
set -l tmpfile (mktemp)
echo "data" > $tmpfile
# ... use $tmpfile ...
rm -f $tmpfile

# Temp directory with cleanup
function with_temp
    set -l tmpdir (mktemp -d)
    pushd $tmpdir
    eval $argv
    popd
    rm -rf $tmpdir
end
```

### Parallel Execution

```fish
# Background jobs
for host in server1 server2 server3
    ssh $host "uptime" &
end
wait    # wait for all background jobs

# With status collection
set -l pids
for task in $tasks
    process_task $task &
    set -a pids $last_pid
end
for pid in $pids
    wait $pid
end
```
