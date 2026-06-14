---
app: Tailscale
icon: network
color: "#2D5BE4"
website: https://tailscale.com
category: New Features
---

- Fleet Device Management and Huntress Managed EDR are now generally available as device posture integrations for Tailscale, letting you use real endpoint security signals in your access policies
- When a device's posture changes in Fleet or Huntress, Tailscale access policies respond automatically without requiring manual updates to your tailnet policy file
- Device posture operators IS SET and NOT SET were also added, letting you write rules that check whether a posture attribute exists at all, not just its value
- Combine posture checks with ACL grants to ensure that only healthy, managed devices can reach sensitive resources in your tailnet
