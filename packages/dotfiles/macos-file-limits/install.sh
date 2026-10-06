#!/bin/bash

set -euo pipefail
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target_helper=/usr/local/libexec/jerred-maxfiles
target_plist=/Library/LaunchDaemons/com.jerred.maxfiles.plist
service=system/com.jerred.maxfiles

fail() {
    printf 'maxfiles installer: %s\n' "$*" >&2
    exit 1
}

[[ "$(/usr/bin/uname -s)" == Darwin ]] || fail 'this installer requires macOS'
[[ $# -le 1 ]] || fail 'usage: install.sh [--validate | --check | --uninstall]'
action="${1:-install}"
case "$action" in
    install|--validate|--check|--uninstall) ;;
    *) fail 'usage: install.sh [--validate | --check | --uninstall]' ;;
esac

validate_source() {
    /bin/bash -n "$source_dir/apply.sh"
    /usr/bin/plutil -lint "$source_dir/com.jerred.maxfiles.plist"
}

check_target() {
    local target="$1" expected="$2"
    [[ ! -L "$target" ]] || fail "refusing symlink: $target"
    if [[ -e "$target" ]]; then
        [[ -f "$target" ]] || fail "expected a regular file: $target"
        [[ "$(/usr/bin/stat -f '%u:%g:%Lp' "$target")" == "$expected" ]] || fail "unexpected ownership or mode: $target"
    fi
}

read_job_exit_code() {
    local line
    job_exit_code=
    while IFS= read -r line; do
        if [[ "$line" =~ ^[[:space:]]*last[[:space:]]exit[[:space:]]code[[:space:]]=[[:space:]](-?[0-9]+)(:.*)?[[:space:]]*$ ]]; then
            job_exit_code="${BASH_REMATCH[1]}"
            return
        fi
    done <<< "$1"
}

check_installation() {
    local job limits resource soft hard extra
    [[ -f "$target_helper" && -f "$target_plist" ]] || fail 'configuration is not installed'
    check_target "$target_helper" 0:0:755
    check_target "$target_plist" 0:0:644
    /usr/bin/cmp -s "$source_dir/apply.sh" "$target_helper" || fail 'installed helper differs from source'
    /usr/bin/cmp -s "$source_dir/com.jerred.maxfiles.plist" "$target_plist" || fail 'installed plist differs from source'
    job="$(/bin/launchctl print "$service")" || fail 'launchd job is not loaded'
    read_job_exit_code "$job"
    [[ "$job_exit_code" == 0 ]] || fail 'boot helper has not completed successfully; inspect /var/log/com.jerred.maxfiles.log'
    limits="$(/bin/launchctl limit maxfiles)" || fail 'cannot read launchd limits'
    read -r resource soft hard extra <<< "$limits" || fail 'empty launchctl output'
    [[ "$resource" == maxfiles && -z "$extra" ]] || fail 'unexpected launchctl output'
    if [[ "$soft" != unlimited ]]; then
        [[ "$soft" =~ ^[1-9][0-9]*$ && ${#soft} -le 12 ]] || fail 'invalid launchd soft limit'
        ((soft >= 8192)) || fail "launchd soft limit is still $soft"
    fi
    printf 'Installed and loaded: launchd soft=%s hard=%s\n' "$soft" "$hard"
    printf 'Current shell soft limit: %s. Existing processes keep their inherited limits.\n' "$(ulimit -Sn)"
}

case "$action" in
    --validate)
        validate_source
        exit 0
        ;;
    --check)
        validate_source
        check_installation
        exit 0
        ;;
esac

if [[ "$(/usr/bin/id -u)" != 0 ]]; then
    if [[ "$action" == --uninstall ]]; then
        fail "run from your terminal: sudo /bin/bash '$source_dir/install.sh' --uninstall"
    fi
    fail "run from your terminal: sudo /bin/bash '$source_dir/install.sh'"
fi
check_target "$target_helper" 0:0:755
check_target "$target_plist" 0:0:644

if [[ "$action" == --uninstall ]]; then
    if /bin/launchctl print "$service" >/dev/null 2>&1; then
        /bin/launchctl bootout "$service"
    fi
    /bin/rm -f "$target_plist" "$target_helper"
    printf 'Removed the boot configuration. Reboot to restore the default launchd limits. Logs are retained.\n'
    exit 0
fi

validate_source
for directory in /usr/local /usr/local/libexec /Library/LaunchDaemons; do
    [[ ! -L "$directory" ]] || fail "refusing symlink directory: $directory"
    if [[ -e "$directory" ]]; then
        [[ -d "$directory" && "$(/usr/bin/stat -f '%u:%g:%Lp' "$directory")" == 0:0:755 ]] || fail "unexpected directory ownership or mode: $directory"
    else
        /usr/bin/install -d -m 755 -o root -g wheel "$directory"
    fi
done

if /bin/launchctl print "$service" >/dev/null 2>&1; then
    /bin/launchctl bootout "$service"
fi
/usr/bin/install -m 755 -o root -g wheel "$source_dir/apply.sh" "$target_helper"
/usr/bin/install -m 644 -o root -g wheel "$source_dir/com.jerred.maxfiles.plist" "$target_plist"
/bin/launchctl bootstrap system "$target_plist"

# bootstrap returns before the one-shot helper finishes. Poll in the foreground.
for ((attempt = 0; attempt < 15; attempt++)); do
    job="$(/bin/launchctl print "$service")" || fail 'launchd job disappeared after loading'
    # Before the first exit, launchd reports "(never exited)" rather than a code.
    read_job_exit_code "$job"
    if [[ "$job_exit_code" == 0 ]]; then
        check_installation
        printf 'Log out and back in, or reboot, then verify fresh app and Codex limits.\n'
        exit 0
    fi
    if [[ -n "$job_exit_code" ]]; then
        fail 'boot helper failed; inspect /var/log/com.jerred.maxfiles.log'
    fi
    /bin/sleep 1
done
fail 'boot helper did not finish within 15 seconds; inspect /var/log/com.jerred.maxfiles.log'
