---
app: Tailscale
icon: network
color: "#2D5BE4"
website: https://tailscale.com
category: New Features
---

- Tailscale Funnel and Tailscale Serve now support the PROXY protocol, which forwards the original client connection metadata (source IP and port) to your backend server before traffic begins
- Without PROXY protocol, your server only sees the Tailscale relay address instead of the real client IP, making it hard to log, rate-limit, or block specific callers
- Enable it in your serve configuration to give your application accurate client IP information for access logs and security rules
