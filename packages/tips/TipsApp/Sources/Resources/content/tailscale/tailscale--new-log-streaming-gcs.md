---
app: Tailscale
icon: network
color: "#2D5BE4"
website: https://tailscale.com
category: New Features
---

- Tailscale can now stream network flow logs and configuration audit logs directly to Google Cloud Storage, joining the existing support for S3-compatible storage and other log destinations
- This lets you retain and analyze Tailscale logs using your existing GCP infrastructure, IAM policies, and data pipelines without a separate intermediary
- Network flow logs record traffic metadata across your tailnet while configuration audit logs capture changes made by admins in the admin console or via the API
