#!/usr/bin/env bash
# Woodpecker step pods egress only on TCP 443: every CI apt path must switch the
# image's sources to HTTPS before `apt-get update`.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APT_HTTPS="${SCRIPT_DIR}/apt-https.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() {
  echo "apt-https: $1" >&2
  exit 1
}

# Without a CA bundle apt cannot verify the HTTPS mirrors; refuse loudly.
mkdir -p "$TEST_ROOT/no-ca/etc/apt"
printf 'deb http://deb.debian.org/debian bookworm main\n' >"$TEST_ROOT/no-ca/etc/apt/sources.list"
if bash "$APT_HTTPS" "$TEST_ROOT/no-ca" 2>"$TEST_ROOT/no-ca.log"; then
  fail "must refuse to switch sources before ca-certificates is installed"
fi
rg -Fq 'install ca-certificates' "$TEST_ROOT/no-ca.log" || fail "must name the missing ca-certificates"
rg -Fq 'http://deb.debian.org' "$TEST_ROOT/no-ca/etc/apt/sources.list" ||
  fail "must leave sources untouched when it refuses"

# Debian (deb822), Ubuntu (deb822) and legacy one-line sources all switch;
# comments stay as written.
root="$TEST_ROOT/image"
mkdir -p "$root/etc/ssl/certs" "$root/etc/apt/sources.list.d"
printf 'certificate\n' >"$root/etc/ssl/certs/ca-certificates.crt"
cat >"$root/etc/apt/sources.list.d/debian.sources" <<'EOF'
Types: deb
# http://snapshot.debian.org/archive/debian/20261005T000000Z
URIs: http://deb.debian.org/debian
Suites: bookworm bookworm-updates
Components: main

Types: deb
URIs: http://deb.debian.org/debian-security
Suites: bookworm-security
Components: main
EOF
cat >"$root/etc/apt/sources.list.d/ubuntu.sources" <<'EOF'
Types: deb
URIs: http://archive.ubuntu.com/ubuntu/
Suites: noble noble-updates
Components: main universe

Types: deb
URIs: http://security.ubuntu.com/ubuntu/
Suites: noble-security
Components: main universe
EOF
cat >"$root/etc/apt/sources.list" <<'EOF'
# deb http://example.invalid/commented stable main
deb [arch=amd64] http://archive.ubuntu.com/ubuntu noble main
deb-src http://deb.debian.org/debian bookworm main
EOF
chmod 0640 "$root/etc/apt/sources.list"

bash "$APT_HTTPS" "$root"
bash "$APT_HTTPS" "$root"

if rg -n '^\s*((deb|deb-src)\s|URIs:).*http://' "$root/etc/apt"; then
  fail "left a plain-HTTP apt source"
fi
for expected in \
  'URIs: https://deb.debian.org/debian' \
  'URIs: https://deb.debian.org/debian-security' \
  'URIs: https://archive.ubuntu.com/ubuntu/' \
  'URIs: https://security.ubuntu.com/ubuntu/' \
  'deb [arch=amd64] https://archive.ubuntu.com/ubuntu noble main' \
  'deb-src https://deb.debian.org/debian bookworm main' \
  '# http://snapshot.debian.org/archive/debian/20261005T000000Z' \
  '# deb http://example.invalid/commented stable main'; do
  rg -Fqx "$expected" "$root/etc/apt" || fail "expected line missing after rewrite: $expected"
done
[[ -n "$(find "$root/etc/apt/sources.list" -perm 0640)" ]] || fail "must preserve the sources file mode"

# Every CI apt path runs the switch first: the stale-image fallbacks inside
# step pods, and both images, so a current image already uses HTTPS.
TOOLCHAIN="${SCRIPT_DIR}/toolchain.sh"
SWIFTLINT_BOOTSTRAP="${SCRIPT_DIR}/swiftlint/bootstrap.sh"
if rg -n 'apt-get (update|install)' "$TOOLCHAIN" | rg -v '^[0-9]+:      apt-get (update -qq|install -y -qq --no-install-recommends "\$@")$'; then
  fail "toolchain.sh must install packages through ci_apt_install"
fi
rg -Fq 'bash ci/scripts/apt-https.sh' "$TOOLCHAIN" || fail "toolchain.sh fallbacks must switch apt to HTTPS"
awk '
  /bash "\$swiftlint_scripts\/\.\.\/apt-https\.sh"/ { switched = NR }
  /apt-get update/ { if (!switched) exit 1; updated = NR }
  END { if (!updated) exit 1 }
' "$SWIFTLINT_BOOTSTRAP" || fail "SwiftLint bootstrap must switch apt to HTTPS before apt-get update"
for dockerfile in "${SCRIPT_DIR}/../ci-image/Dockerfile" "${SCRIPT_DIR}/../ci-playwright/Dockerfile"; do
  rg -Fq -- '--mount=type=bind,source=ci/scripts/apt-https.sh,target=/tmp/apt-https.sh' "$dockerfile" ||
    fail "$dockerfile must bake HTTPS apt sources"
done

echo "apt-https tests passed"
