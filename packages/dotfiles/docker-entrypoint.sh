#!/bin/bash
set -e

TARGET_USER="jerred"
CURRENT_UID="$(id -u)"
CURRENT_GID="$(id -g)"

# -----------------------------------------------------------------------------
# Security warnings for dangerous runtime configurations
# -----------------------------------------------------------------------------
warn_security() {
    echo "[SECURITY WARNING] $1" >&2
}

# Check for privileged mode (all capabilities = privileged)
if [[ -f /proc/self/status ]]; then
    CAP_EFF=$(grep CapEff /proc/self/status | awk '{print $2}')
    # Full capabilities (privileged) is typically 0000003fffffffff or higher
    if [[ "$CAP_EFF" == "0000003fffffffff" ]] || [[ "$CAP_EFF" > "0000003fffffffff" ]]; then
        warn_security "Container is running in PRIVILEGED mode - this grants host-level access"
    fi
fi

# Check for docker.sock mount (container escape vector)
if [[ -S /var/run/docker.sock ]]; then
    warn_security "docker.sock is mounted - this allows container escape via Docker API"
fi

# Check for host filesystem mounts
if [[ -d /host ]] || [[ -w /etc/shadow ]]; then
    warn_security "Host filesystem appears to be mounted - container has host file access"
fi

# Check for host PID namespace (can see/signal host processes)
if [[ -f /proc/1/cmdline ]]; then
    INIT_CMD=$(cat /proc/1/cmdline 2>/dev/null | tr '\0' ' ')
    if [[ "$INIT_CMD" == *"systemd"* ]] || [[ "$INIT_CMD" == *"/sbin/init"* ]]; then
        warn_security "Host PID namespace detected - container can see and signal host processes"
    fi
fi

# Check for host network namespace
# In host network mode, we can see the docker0 bridge interface (only visible from host)
if [[ -d /sys/class/net/docker0 ]]; then
    warn_security "Host network namespace likely detected - container has direct host network access"
fi

# Check for raw device access
if [[ -e /dev/sda ]] || [[ -e /dev/nvme0 ]] || [[ -e /dev/mem ]]; then
    warn_security "Raw device access detected - container can read/write host disks or memory"
fi

# Warn if running as actual root without HOST_UID (not dropping privileges)
if [[ "$CURRENT_UID" == "0" ]] && [[ -z "${HOST_UID:-}" ]]; then
    warn_security "Running as root without HOST_UID set - will not drop privileges"
fi

# -----------------------------------------------------------------------------
# If running as root with HOST_UID/HOST_GID set, remap user and drop privileges
if [[ "$CURRENT_UID" == "0" ]] && [[ -n "${HOST_UID:-}" ]]; then
    TARGET_UID="${HOST_UID}"
    TARGET_GID="${HOST_GID:-$HOST_UID}"

    # Modify the target user to have the host's UID/GID
    usermod -u "$TARGET_UID" "$TARGET_USER" 2>/dev/null || true
    groupmod -g "$TARGET_GID" "$TARGET_USER" 2>/dev/null || true

    # Fix ownership of key directories
    chown -R "$TARGET_UID:$TARGET_GID" "/home/$TARGET_USER" 2>/dev/null || true
    chown -R "$TARGET_UID:$TARGET_GID" /home/linuxbrew 2>/dev/null || true

    # Fix ownership of cache directories (typically mounted as volumes)
    # These may be shared across containers for build caching
    CACHE_DIRS=(
        "/workspace/.cargo/registry"
        "/workspace/.cargo/git"
        "/workspace/.cache/sccache"
    )
    for dir in "${CACHE_DIRS[@]}"; do
        if [[ -d "$dir" ]]; then
            chown -R "$TARGET_UID:$TARGET_GID" "$dir" 2>/dev/null || true
        fi
    done

    # Switch to the user and execute
    exec gosu "$TARGET_USER" "$@"
fi

# If running as non-root with unknown UID, add entry to passwd/group
if [[ "$CURRENT_UID" != "0" ]] && ! getent passwd "$CURRENT_UID" &>/dev/null; then
    # Add user to passwd if we have write access
    if [[ -w /etc/passwd ]]; then
        echo "${TARGET_USER}:x:${CURRENT_UID}:${CURRENT_GID}::/home/${TARGET_USER}:/home/linuxbrew/.linuxbrew/bin/fish" >> /etc/passwd
    fi
    if [[ -w /etc/group ]] && ! getent group "$CURRENT_GID" &>/dev/null; then
        echo "${TARGET_USER}:x:${CURRENT_GID}:" >> /etc/group
    fi
fi

# Trust mise configuration files (suppresses interactive prompts)
if command -v mise &>/dev/null; then
    mise trust --all 2>/dev/null || true
fi

exec "$@"
