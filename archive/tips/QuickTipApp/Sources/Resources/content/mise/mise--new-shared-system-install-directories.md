---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- Run `mise install --system` to install tools to `/usr/local/share/mise/installs` so every user on the machine automatically shares them without re-downloading
- Use `mise install --shared <path>` to install tools to a custom shared directory visible to all users
- Add extra read-only lookup directories with the `shared_install_dirs` setting or `MISE_SHARED_INSTALL_DIRS` env var (colon-separated)
- Shared versions appear in `mise ls` with `(system)` or `(shared)` labels
- Ideal for Docker images, devcontainers, and bastion hosts where downloading the same tools repeatedly wastes time
