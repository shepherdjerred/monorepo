---
app: Zellij
icon: rectangle.split.3x3
color: "#FFA500"
website: https://zellij.dev
category: New in 0.43.0
---

- Open a new stacked pane directly on top of the current one with Ctrl p then s (or Ctrl g then p then s in unlock-first preset)
- Add this to your config in the pane keybinds section: bind "s" { NewPane "stacked"; SwitchToMode "normal"; }
- Stacked panes share screen space and show only one pane at full size while displaying title bars for the rest
