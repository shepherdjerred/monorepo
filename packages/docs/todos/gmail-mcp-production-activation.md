---
id: gmail-mcp-production-activation
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/plans/2026-06-13_gmail-mcp-server-swap.md
source_marker: false
---

# Activate and verify the replacement Gmail MCP server

## Remaining

- [ ] Provision the selected OAuth or IMAP credentials in 1Password without
      recording secret values in git.
- [ ] Deploy or restart the MCP gateway with the replacement server.
- [ ] Exercise authorized list, search, read, and thread operations and confirm
      the server fails closed for invalid credentials.

## Comment Log

- 2026-07-27 — Split from server selection and gateway implementation because
  credential provisioning and mailbox access are privileged operations.
