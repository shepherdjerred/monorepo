---
app: fd
icon: doc.text.magnifyingglass
color: "#89B4FA"
website: https://github.com/sharkdp/fd
category: New in v10.3
---

- Since v10.3, date durations in --changed-within and --changed-before are calendar-aware: months and years reflect actual calendar length, not a fixed number of seconds
- Use "mo", "month", or "months" instead of "M" — "M" no longer means month (it was ambiguous with minutes)
- Example: fd --changed-within 1month finds files modified in the last calendar month
