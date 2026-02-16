export const fastmailSkill = `---
name: fastmail
description: Read and send email via Fastmail using himalaya
metadata:
  openclaw:
    requires:
      env: ["FASTMAIL_TOKEN"]
---
# Fastmail

Use himalaya CLI for email operations.

## Setup (first run)
himalaya account configure --backend jmap --jmap-url https://api.fastmail.com/jmap/session

## Common Operations
- List emails: himalaya list
- Read email: himalaya read {id}
- Send email: himalaya send --to user@example.com --subject "..." --body "..."
- Search: himalaya search "query"
`;
