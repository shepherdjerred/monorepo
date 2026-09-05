---
name: web-design-guidelines
description: "Use this skill for Review UI code for Web Interface Guidelines compliance. Use when asked to \"review my UI\", \"check…"
license: MIT
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

This repo-owned adapter keeps the upstream review format and source URL. It is a
review aid, not a deployment workflow: inspect the local files, report concrete
`file:line` findings, and verify accessibility and behavior with the project's
own tests or browser tooling when available.

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Fetch the latest guidelines from the source URL below
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in the fetched guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

Fetch the reviewed guidelines before each review:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/d0a657bfe87e86dd3a4753d7ec28c7e7dd7a88fe/command.md
```

Use WebFetch to retrieve the reviewed rules. The fetched content contains all the rules and output format instructions.

## Usage

When a user provides a file or pattern argument:
1. Fetch guidelines from the source URL above
2. Read the specified files
3. Apply all rules from the fetched guidelines
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
