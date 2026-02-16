# =============================================================================
# Dotfiles Docker Image
# =============================================================================
#
# OPTIMIZATIONS APPLIED (16.7GB -> 5.35GB, 68% reduction):
#
# 1. MULTI-STAGE BUILD
#    - Builder stage: installs everything, cleans up
#    - Runtime stage: fresh Ubuntu, copies only needed artifacts
#    - Eliminates build-time dependencies from final image
#
# 2. USER-BASED INSTALLATION (not root)
#    - install.sh runs as target user, not root
#    - Avoids messy copy/chown hacks for /root -> /home/user
#    - All paths (mise, cargo, rustup) are correct from the start
#
# 3. REMOVE HOMEBREW GCC/BINUTILS (~800MB saved)
#    - Use apt's gcc/g++/mold instead (~55MB)
#    - Sufficient for Rust compilation and -sys crates
#
# 4. STRIP DEBUG SYMBOLS (~900MB saved)
#    - Rust toolchain: strip binaries and .so files
#    - Mise runtimes: strip node, python .so files, etc.
#
# 5. REMOVE RUST DOCUMENTATION (~755MB saved)
#    - ~/.rustup/toolchains/*/share/doc not needed in container
#
# 6. CLEANUP CACHES AND UNNECESSARY FILES
#    - Homebrew cache, download artifacts
#    - Mise downloads and cache
#    - .git directories from cloned repos
#    - Homebrew docs/man/info/locale
#
# =============================================================================

# =============================================================================
# Stage 1: Builder - Install everything as target user
# =============================================================================
FROM ubuntu:24.04 AS builder

ARG USER_UID=1000
ARG USER_GID=1000
ARG USERNAME=jerred

ENV DEBIAN_FRONTEND=noninteractive \
    NONINTERACTIVE=1 \
    APT_LISTCHANGES_FRONTEND=none

# -----------------------------------------------------------------------------
# Install minimal build dependencies
# -----------------------------------------------------------------------------
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# Create user and groups
# Handle existing GID/UID 1000 from Ubuntu base image (ubuntu user/group)
# -----------------------------------------------------------------------------
RUN (groupadd --gid ${USER_GID} ${USERNAME} 2>/dev/null || groupmod -n ${USERNAME} $(getent group ${USER_GID} | cut -d: -f1)) && \
    (useradd --uid ${USER_UID} --gid ${USER_GID} -m ${USERNAME} -s /bin/bash 2>/dev/null || usermod -l ${USERNAME} -d /home/${USERNAME} -m $(getent passwd ${USER_UID} | cut -d: -f1) 2>/dev/null || true) && \
    echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/${USERNAME} && \
    chmod 0440 /etc/sudoers.d/${USERNAME} && \
    groupadd -r brew && \
    usermod -aG brew ${USERNAME}

# -----------------------------------------------------------------------------
# Pre-create linuxbrew directory with correct ownership
# Homebrew will install here, owned by user with brew group write access
# -----------------------------------------------------------------------------
RUN mkdir -p /home/linuxbrew/.linuxbrew && \
    chown -R ${USERNAME}:brew /home/linuxbrew && \
    chmod -R g+w /home/linuxbrew

# -----------------------------------------------------------------------------
# Copy dotfiles and initialize as git repo (required for chezmoi)
# -----------------------------------------------------------------------------
COPY --chown=${USERNAME}:${USERNAME} . /opt/dotfiles
WORKDIR /opt/dotfiles
RUN git config --global --add safe.directory /opt/dotfiles && \
    git init && \
    git config user.email "docker@localhost" && \
    git config user.name "Docker Build" && \
    git add . && \
    git commit -m "Initial commit"

# -----------------------------------------------------------------------------
# Run installation AS USER (key optimization!)
# - install.sh uses sudo only for apt-get and /etc writes
# - Everything else installs directly to user's home
# - No need for post-install copy/chown/symlink fixes
# -----------------------------------------------------------------------------
USER ${USERNAME}
WORKDIR /home/${USERNAME}

RUN git config --global --add safe.directory '*' && \
    chmod +x /opt/dotfiles/install.sh && \
    DOTFILES_LOCAL_PATH=/opt/dotfiles bash /opt/dotfiles/install.sh

# -----------------------------------------------------------------------------
# Cleanup Homebrew AS USER (brew refuses to run as root)
# Remove gcc/binutils - we use apt's versions instead (~800MB saved)
# -----------------------------------------------------------------------------
RUN eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)" && \
    brew cleanup --prune=all -s && \
    brew uninstall --ignore-dependencies gcc 2>/dev/null || true && \
    brew uninstall --ignore-dependencies binutils 2>/dev/null || true && \
    brew autoremove 2>/dev/null || true

# -----------------------------------------------------------------------------
# Final cleanup (as root for full filesystem access)
# -----------------------------------------------------------------------------
USER root
RUN \
    # -------------------------------------------------------------------------
    # RUST OPTIMIZATION (~855MB saved)
    # Remove documentation (755MB) and strip debug symbols (~100MB)
    # -------------------------------------------------------------------------
    rm -rf /home/${USERNAME}/.rustup/toolchains/*/share/doc && \
    find /home/${USERNAME}/.rustup -type f \( -name "*.so" -o -executable \) \
        -exec strip --strip-unneeded {} \; 2>/dev/null || true && \
    \
    # -------------------------------------------------------------------------
    # MISE RUNTIMES OPTIMIZATION (~20MB saved)
    # Strip debug symbols from node, python .so files, go binaries, etc.
    # -------------------------------------------------------------------------
    find /home/${USERNAME}/.local/share/mise/installs -type f \( -name "*.so" -o -executable \) \
        -exec strip --strip-unneeded {} \; 2>/dev/null || true && \
    \
    # -------------------------------------------------------------------------
    # HOMEBREW CLEANUP
    # Remove docs, man pages, locale files (not needed in container)
    # -------------------------------------------------------------------------
    rm -rf /home/linuxbrew/.linuxbrew/share/doc && \
    rm -rf /home/linuxbrew/.linuxbrew/share/man && \
    rm -rf /home/linuxbrew/.linuxbrew/share/info && \
    rm -rf /home/linuxbrew/.linuxbrew/share/locale && \
    \
    # -------------------------------------------------------------------------
    # REMOVE .git DIRECTORIES
    # Saves space and not needed for runtime
    # -------------------------------------------------------------------------
    find /home/linuxbrew/.linuxbrew -name ".git" -type d -exec rm -rf {} + 2>/dev/null || true && \
    rm -rf /home/linuxbrew/.linuxbrew/Homebrew/.git && \
    rm -rf /home/${USERNAME}/.tmux/plugins/*/.git && \
    rm -rf /home/${USERNAME}/.config/delta/themes/.git && \
    \
    # -------------------------------------------------------------------------
    # CACHE CLEANUP
    # Remove download caches and build artifacts
    # -------------------------------------------------------------------------
    rm -rf /home/${USERNAME}/.cache/Homebrew && \
    rm -rf /home/${USERNAME}/.local/share/mise/downloads/* && \
    rm -rf /home/${USERNAME}/.local/share/mise/cache/* && \
    rm -rf /home/${USERNAME}/.npm && \
    rm -rf /home/${USERNAME}/.cargo/registry && \
    rm -rf /home/${USERNAME}/.cargo/git && \
    \
    # -------------------------------------------------------------------------
    # MISC CLEANUP
    # -------------------------------------------------------------------------
    rm -rf /tmp/* /var/tmp/* && \
    rm -rf /opt/dotfiles && \
    rm -rf /var/lib/dotfiles/*.log /var/lib/dotfiles/*.json /var/lib/dotfiles/*.txt && \
    \
    # -------------------------------------------------------------------------
    # FIX OWNERSHIP
    # Ensure everything is owned by the target user
    # -------------------------------------------------------------------------
    chown -R ${USERNAME}:${USERNAME} /home/${USERNAME} && \
    chown -R ${USERNAME}:brew /home/linuxbrew && \
    chmod -R g+w /home/linuxbrew

# -----------------------------------------------------------------------------
# Create bash profile script
# Adds ~/.local/bin, linuxbrew, and mise to PATH for bash sessions
# -----------------------------------------------------------------------------
RUN printf '#!/bin/bash\nexport PATH="$HOME/.local/bin:/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:$PATH"\nif command -v mise &>/dev/null; then\n    eval "$(mise activate bash --shims)"\nfi\n' > /etc/profile.d/linuxbrew.sh && \
    chmod +x /etc/profile.d/linuxbrew.sh


# =============================================================================
# Stage 2: Runtime - Fresh image with only needed artifacts
# =============================================================================
FROM ubuntu:24.04 AS runtime

ARG USER_UID=1000
ARG USER_GID=1000
ARG USERNAME=jerred

ENV DEBIAN_FRONTEND=noninteractive \
    NONINTERACTIVE=1 \
    APT_LISTCHANGES_FRONTEND=none \
    HOME="/home/${USERNAME}" \
    USER="${USERNAME}" \
    LANG="en_US.UTF-8" \
    LC_ALL="en_US.UTF-8" \
    # PATH includes mise shims for bun/node/rust/etc, cargo bin, and user local bin
    PATH="/home/${USERNAME}/.local/share/mise/shims:/home/${USERNAME}/.cargo/bin:/home/${USERNAME}/.local/bin:/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    BASH_ENV="/etc/profile.d/linuxbrew.sh"

# -----------------------------------------------------------------------------
# Install runtime dependencies
# Using apt gcc/g++/mold instead of Homebrew (~55MB vs ~860MB)
# These are needed for Rust compilation (linking, -sys crates)
# -----------------------------------------------------------------------------
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    sudo \
    gosu \
    locales \
    # Build tools for Rust/native modules (~55MB vs Homebrew's ~860MB)
    # build-essential includes gcc, g++, make, libc6-dev, and sets up cc symlink
    build-essential \
    mold \
    lld \
    pkg-config \
    && locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# Create user and groups (must exist before COPY --chown)
# -----------------------------------------------------------------------------
RUN (groupadd --gid ${USER_GID} ${USERNAME} 2>/dev/null || groupmod -n ${USERNAME} $(getent group ${USER_GID} | cut -d: -f1)) && \
    (useradd --uid ${USER_UID} --gid ${USER_GID} -m ${USERNAME} -s /bin/bash 2>/dev/null || usermod -l ${USERNAME} -d /home/${USERNAME} -m $(getent passwd ${USER_UID} | cut -d: -f1) 2>/dev/null || true) && \
    groupadd -r brew && \
    usermod -aG brew ${USERNAME} && \
    mkdir -p /home/linuxbrew

# -----------------------------------------------------------------------------
# Copy artifacts from builder stage
# Using --chown to set correct ownership during copy (no extra layer)
# -----------------------------------------------------------------------------
COPY --from=builder --chown=${USERNAME}:brew /home/linuxbrew/.linuxbrew /home/linuxbrew/.linuxbrew
COPY --from=builder --chown=${USERNAME}:${USERNAME} /home/${USERNAME} /home/${USERNAME}
COPY --from=builder /etc/profile.d/linuxbrew.sh /etc/profile.d/linuxbrew.sh
COPY --from=builder /etc/shells /etc/shells
COPY --from=builder --chown=${USERNAME}:${USERNAME} /var/lib/dotfiles /var/lib/dotfiles

# -----------------------------------------------------------------------------
# Setup entrypoint and default shell
# Entrypoint handles UID/GID remapping for volume mounts
# -----------------------------------------------------------------------------
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh && \
    chsh -s /home/linuxbrew/.linuxbrew/bin/fish ${USERNAME}

# -----------------------------------------------------------------------------
# Support arbitrary UIDs (OpenShift/Kubernetes compatibility)
# Allow any user to use sudo and make directories writable by root group
# Must come AFTER COPY commands to preserve permissions
# -----------------------------------------------------------------------------
RUN echo "ALL ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/arbitrary-uids && \
    chmod 0440 /etc/sudoers.d/arbitrary-uids && \
    chmod -R g+w /var/lib/apt/lists /var/cache/apt && \
    chgrp -R root /home/${USERNAME} /home/linuxbrew /var/lib/dotfiles && \
    chmod -R g+w /home/${USERNAME} /home/linuxbrew /var/lib/dotfiles && \
    # Allow entrypoint to add passwd/group entries for arbitrary UIDs
    # Must be world-writable since arbitrary UIDs won't be in root group
    chmod a+w /etc/passwd /etc/group

USER ${USERNAME}
WORKDIR /home/${USERNAME}

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/home/linuxbrew/.linuxbrew/bin/fish"]
