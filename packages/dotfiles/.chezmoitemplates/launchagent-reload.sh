#!/bin/bash
GUI_DOMAIN="gui/$(id -u)"

wait_for_unload() {
    local service="$1"
    local attempts=0
    local max_attempts="${LAUNCHAGENT_UNLOAD_MAX_ATTEMPTS:-200}"
    local poll_seconds="${LAUNCHAGENT_UNLOAD_POLL_SECONDS:-0.05}"
    while launchctl print "$service" >/dev/null 2>&1; do
        if [ "$attempts" -ge "$max_attempts" ]; then
            return 1
        fi
        attempts=$((attempts + 1))
        sleep "$poll_seconds"
    done
}

# Always inspect the domain we will mutate. `launchctl list` instead inspects
# the caller's domain, which can be an SSH/Background session.
reload_agent() {
    local label="$1" program="$2"
    local plist="$HOME/Library/LaunchAgents/$label.plist"
    local service="$GUI_DOMAIN/$label" status
    if [ ! -f "$plist" ] || ! command -v "$program" >/dev/null; then
        return
    fi
    if ! launchctl print "$GUI_DOMAIN" >/dev/null 2>&1; then
        printf 'LaunchAgent %s: %s is unavailable; log into the macOS GUI before applying LaunchAgents.\n' "$label" "$GUI_DOMAIN" >&2
        return 1
    fi
    # Reject malformed updates before unloading the working job.
    plutil -lint "$plist"
    if launchctl print "$service" >/dev/null 2>&1; then
        if launchctl bootout "$service"; then
            :
        else
            status=$?
            printf 'LaunchAgent %s: bootout failed in %s (exit %s).\n' "$label" "$GUI_DOMAIN" "$status" >&2
            return "$status"
        fi
        # `launchctl bootout` returns once SIGTERM is queued, while launchd is
        # still tearing down a running KeepAlive agent. Calling bootstrap before
        # removal finishes fails with EALREADY (reported by launchctl as exit 5).
        if ! wait_for_unload "$service"; then
            printf 'LaunchAgent %s: %s did not finish unloading after bootout.\n' "$label" "$service" >&2
            return 1
        fi
    fi
    if launchctl bootstrap "$GUI_DOMAIN" "$plist"; then
        :
    else
        status=$?
        printf 'LaunchAgent %s: bootstrap failed in %s (exit %s); inspect %s.\n' "$label" "$GUI_DOMAIN" "$status" "$plist" >&2
        return "$status"
    fi
    # bootstrap returning success is not evidence the exact job is registered.
    if launchctl print "$service" >/dev/null; then
        :
    else
        status=$?
        printf 'LaunchAgent %s: registration readback failed for %s (exit %s).\n' "$label" "$service" "$status" >&2
        return "$status"
    fi
}
