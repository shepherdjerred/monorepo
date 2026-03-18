---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- `mise use dotnet@8` now installs via a native core plugin with side-by-side version support under a shared `DOTNET_ROOT`
- Supports `global.json` for per-project SDK pinning, matching .NET's native multi-version model
- Uses Microsoft's official `dotnet-install` script under the hood
- Configure the install root via the `dotnet.dotnet_root` setting
