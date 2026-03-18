---
app: Zellij
icon: rectangle.split.3x3
color: "#FFA500"
website: https://zellij.dev
category: New in 0.43.0
---

- Configure a post_command_discovery_hook in your config to fix session resurrection for commands wrapped by tools like nix or shell pipelines
- The hook lets you edit how Zellij detects and serializes running commands before saving session state
- Useful when resurrect sessions show wrong or missing commands due to wrapper scripts or non-standard shells
