#!/bin/bash

set -euo pipefail
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

fail() {
    printf 'maxfiles: %s\n' "$*" >&2
    exit 1
}

positive_integer() {
    [[ "$1" =~ ^[1-9][0-9]*$ ]] && [[ ${#1} -le 12 ]]
}

read_limits() {
    local output resource extra
    output="$(/bin/launchctl limit maxfiles)" || fail 'cannot read launchd limits'
    read -r resource launch_soft launch_hard extra <<< "$output" || fail 'empty launchctl limit output'
    [[ "$resource" == maxfiles && -z "$extra" && "$output" != *$'\n'* ]] || fail 'unexpected launchctl limit output'
    [[ "$launch_soft" == unlimited ]] || positive_integer "$launch_soft" || fail 'invalid soft limit'
    [[ "$launch_hard" == unlimited ]] || positive_integer "$launch_hard" || fail 'invalid hard limit'
}

[[ "$(/usr/bin/uname -s)" == Darwin ]] || fail 'this helper requires macOS'
[[ "$(/usr/bin/id -u)" == 0 ]] || fail 'this helper must run as root'
[[ $# -eq 0 ]] || fail 'this helper takes no arguments'

kernel_max="$(/usr/sbin/sysctl -n kern.maxfiles)" || fail 'cannot read kern.maxfiles'
kernel_per_process="$(/usr/sbin/sysctl -n kern.maxfilesperproc)" || fail 'cannot read kern.maxfilesperproc'
if ! positive_integer "$kernel_max" || ! positive_integer "$kernel_per_process"; then
    fail 'invalid kernel file caps'
fi
((kernel_per_process >= 8192)) || fail 'existing kernel file ceiling is below the requested soft limit'
read_limits

target_soft=8192
if [[ "$launch_soft" == unlimited ]]; then
    printf 'maxfiles: launchd already has an unlimited soft limit; kernel caps unchanged\n'
    exit 0
fi
if ((launch_soft > target_soft)); then
    target_soft="$launch_soft"
fi
target_hard="$launch_hard"
if [[ "$target_hard" == unlimited ]]; then
    # macOS limits open descriptors to this ceiling even when rlim_max is infinite.
    target_hard="$kernel_per_process"
fi
((target_hard >= target_soft && kernel_per_process >= target_soft)) || fail 'existing file ceiling is below the requested soft limit'

restore_kernel_caps() {
    local key expected actual status=0
    for key in kern.maxfiles kern.maxfilesperproc; do
        if [[ "$key" == kern.maxfiles ]]; then
            expected="$kernel_max"
        else
            expected="$kernel_per_process"
        fi
        if ! actual="$(/usr/sbin/sysctl -n "$key")"; then
            printf 'maxfiles: cannot read %s during restoration\n' "$key" >&2
            status=1
            continue
        fi
        if [[ "$actual" != "$expected" ]]; then
            if ! /usr/sbin/sysctl -w "$key=$expected" >/dev/null; then
                printf 'maxfiles: cannot restore %s=%s\n' "$key" "$expected" >&2
                status=1
                continue
            fi
            if ! actual="$(/usr/sbin/sysctl -n "$key")" || [[ "$actual" != "$expected" ]]; then
                printf 'maxfiles: restoration of %s did not persist\n' "$key" >&2
                status=1
            fi
        fi
    done
    return "$status"
}

finish() {
    local status=$?
    trap - EXIT
    if ! restore_kernel_caps; then
        status=1
    fi
    exit "$status"
}
trap finish EXIT

if ((launch_soft < target_soft)); then
    /bin/launchctl limit maxfiles "$target_soft" "$target_hard" || fail 'launchctl refused the new file limit'
fi
restore_kernel_caps || fail 'kernel file caps could not be preserved'
read_limits
[[ "$launch_soft" == "$target_soft" ]] || fail "soft limit readback is $launch_soft, expected $target_soft"
if [[ "$launch_hard" != unlimited ]]; then
    ((launch_hard >= target_hard)) || fail 'launchctl lowered the effective hard limit'
fi
printf 'maxfiles: launchd soft=%s hard=%s; kern.maxfiles=%s kern.maxfilesperproc=%s unchanged\n' \
    "$launch_soft" "$launch_hard" "$kernel_max" "$kernel_per_process"
