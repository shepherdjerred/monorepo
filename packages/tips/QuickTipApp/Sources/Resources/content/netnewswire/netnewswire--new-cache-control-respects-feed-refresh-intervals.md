---
app: NetNewsWire
icon: dot.radiowaves.left.and.right
color: "#F7A535"
website: https://netnewswire.com
category: New in 7.0.2
---

- NetNewsWire 7.0.2 now respects the Cache-Control max-age header from feed servers.
- If a feed server says it won't update for another hour, NetNewsWire won't re-fetch it until then — saving bandwidth and battery.
- Any max-age beyond five hours is capped at five hours to prevent stale feeds from misconfigured servers.
