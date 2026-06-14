---
app: ripgrep
icon: magnifyingglass
color: "#8B5CF6"
website: https://github.com/BurntSushi/ripgrep
category: New in 15.0.0
---

- The `-r/--replace` flag now works together with `--json`, so you can apply replacements and consume structured output at the same time: `rg --json -r '$1' '(pattern)' file`
