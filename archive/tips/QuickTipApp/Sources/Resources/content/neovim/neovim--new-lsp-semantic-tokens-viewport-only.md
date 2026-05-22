---
app: Neovim
icon: text.cursor
color: "#57A143"
website: https://neovim.io
category: New in 0.11
---

- LSP semantic token requests now use textDocument/semanticTokens/range to fetch tokens only for the visible viewport, reducing server load and improving performance in large files.
