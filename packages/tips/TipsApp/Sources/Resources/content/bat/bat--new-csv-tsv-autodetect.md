---
app: bat
icon: doc.text.fill
color: "#FFA657"
website: https://github.com/sharkdp/bat
category: New in v0.26.0
---

- bat now auto-detects the delimiter in CSV and TSV files for better highlighting
- Tab-delimited files (.tsv) are detected automatically without extra configuration
- Pipe-delimited files are also supported: bat --map-syntax='*.psv:CSV' file.psv
