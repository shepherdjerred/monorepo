export const gmailSkill = `---
name: gmail
description: Read and send email via Gmail using himalaya
metadata:
  openclaw:
    requires:
      env: ["GMAIL_TOKEN"]
---
# Gmail

Use himalaya CLI for email operations.

## Common Operations
- List emails: himalaya -a gmail list
- Read email: himalaya -a gmail read {id}
- Send email: himalaya -a gmail send --to user@example.com --subject "..." --body "..."
`;
