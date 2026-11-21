#!/usr/bin/env bash
# Point every apt source at HTTPS. Woodpecker step pods may egress only on TCP
# 443, so the plain-HTTP Debian and Ubuntu mirrors the base images ship with
# are unreachable from a CI step. The CI images run this after installing
# ca-certificates; stale-image fallbacks run it again before `apt-get update`.
# Idempotent. The optional argument is a filesystem root for tests.
set -euo pipefail
shopt -s nullglob

apt_https_root="${1:-}"
apt_https_ca_bundle="$apt_https_root/etc/ssl/certs/ca-certificates.crt"
if [[ ! -s "$apt_https_ca_bundle" ]]; then
  echo "apt-https: $apt_https_ca_bundle is missing; install ca-certificates before switching apt to HTTPS" >&2
  exit 1
fi

# Legacy one-line sources carry the URI on `deb`/`deb-src` lines; deb822
# sources carry it on `URIs:`. Comments (such as snapshot hints) stay as-is.
apt_https_active='^[[:space:]]*((deb|deb-src)[[:space:]]|URIs:)'
for apt_https_file in \
  "$apt_https_root/etc/apt/sources.list" \
  "$apt_https_root"/etc/apt/sources.list.d/*.list \
  "$apt_https_root"/etc/apt/sources.list.d/*.sources; do
  [[ -f "$apt_https_file" ]] || continue
  apt_https_rewritten=$(sed -E "/$apt_https_active/s#http://#https://#g" "$apt_https_file")
  # Write through the existing inode so ownership and mode are preserved.
  printf '%s\n' "$apt_https_rewritten" >"$apt_https_file"
done
