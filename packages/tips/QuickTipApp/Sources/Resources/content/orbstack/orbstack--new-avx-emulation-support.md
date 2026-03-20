---
app: OrbStack
icon: shippingbox.fill
color: "#4F46E5"
website: https://orbstack.dev
category: New in v2.0.2
---

- OrbStack v2.0.2 added AVX emulation support for x86 containers running on Apple Silicon
- AVX (Advanced Vector Extensions) are required by many data science, ML, and cryptography libraries
- Previously, containers using AVX instructions would crash on Apple Silicon even with Rosetta emulation
