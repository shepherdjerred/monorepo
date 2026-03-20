---
app: Tailscale
icon: network
color: "#2D5BE4"
website: https://tailscale.com
category: New Features
---

- Tailscale Services (GA) lets you decouple applications and services from the specific devices that host them, so services remain reachable even as devices change
- Register a service using the API or CLI and it gets a stable virtual IP that other tailnet devices can always reach, regardless of which physical node is backing it
- tsnet applications can act as Tailscale Services hosts, so Go programs embedded in your tailnet participate in the same service discovery
- Kubernetes egress proxies can now forward traffic to Tailscale Service VIPs, enabling seamless cluster-to-tailnet service routing
