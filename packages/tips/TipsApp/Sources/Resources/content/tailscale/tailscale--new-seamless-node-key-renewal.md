---
app: Tailscale
icon: network
color: "#2D5BE4"
website: https://tailscale.com
category: New Features
---

- Node keys now renew seamlessly in the background so clients maintain all existing connections while re-authenticating, eliminating the brief disconnection that used to occur at key expiry
- Previously, key renewal required the client to temporarily drop peers and re-establish connections, which could interrupt long-running SSH sessions or file transfers
- No configuration is needed to benefit from seamless renewal; it happens automatically when your node key approaches its expiry date
