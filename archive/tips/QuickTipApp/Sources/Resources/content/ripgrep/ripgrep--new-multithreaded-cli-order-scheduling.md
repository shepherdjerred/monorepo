---
app: ripgrep
icon: magnifyingglass
color: "#8B5CF6"
website: https://github.com/BurntSushi/ripgrep
category: New in 15.0.0
---

- When using multiple threads, ripgrep now schedules files in the order they were given on the command line, so `rg pattern file1 file2` produces results in a more predictable sequence
