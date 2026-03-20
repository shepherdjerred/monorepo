---
app: Tailscale
icon: network
color: "#2D5BE4"
website: https://tailscale.com
category: New Features
---

- Tailscale Peer Relays (GA) lets you run your own high-throughput relay servers on any Tailscale node when direct peer-to-peer connections are not possible
- Unlike the shared DERP relay network, Peer Relays are customer-deployed and designed for production-level throughput, making them ideal for high-bandwidth workloads across restrictive networks
- Configure static endpoints for your relay server using tailscale set --relay-server-static-endpoints so clients can find it reliably
- Client metrics like tailscaled_peer_relay_forwarded_packets_total and tailscaled_peer_relay_forwarded_bytes_total let you monitor relay usage directly
