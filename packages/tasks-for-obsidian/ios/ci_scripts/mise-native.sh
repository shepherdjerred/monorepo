#!/bin/bash
# Xcode Cloud starts from a tracked checkout with no preinstalled mise.
set -euo pipefail
facet_script_directory="$(cd "$(dirname "$0")" && pwd)"
facet_repo_root="$(cd "$facet_script_directory/../../../.." && pwd)"
mise_version="2026.7.13"
localized_dir="$facet_repo_root/.cache/facet-native-tools/mise"
export MISE_DATA_DIR="$localized_dir"
export MISE_CONFIG_DIR="$localized_dir"
export MISE_CACHE_DIR="$localized_dir/cache"
export MISE_STATE_DIR="$localized_dir/state"
export MISE_TRUSTED_CONFIG_PATHS="$facet_repo_root"
export MISE_IGNORED_CONFIG_PATHS="$HOME/.config/mise"
facet_mise_binary="$localized_dir/mise-$mise_version"
if [ ! -x "$facet_mise_binary" ]; then
    [ "$(uname -s)" = Darwin ] || { echo "Native Apple bootstrap requires macOS." >&2; exit 1; }
    # Immutable release checksums from jdx/mise v2026.7.13 SHASUMS256.txt.
    checksum_macos_x86_64="62563fe6e4799c6e499db4a328632f63499ee864581c923a7bb45bd90e8827bd"
    checksum_macos_arm64="80dad4a76db564540be56ebd19e76165e2425e0b45f6f7aca6ac2d5efa3a6161"
    case "$(uname -m)" in
        x86_64) facet_arch=x64; facet_checksum="$checksum_macos_x86_64" ;;
        arm64) facet_arch=arm64; facet_checksum="$checksum_macos_arm64" ;;
        *) echo "Unsupported native Apple bootstrap architecture." >&2; exit 1 ;;
    esac
    facet_download="$(mktemp -d "${TMPDIR:-/tmp}/facet-mise.XXXXXXXX")"
    trap 'rm -rf "$facet_download"' EXIT
    facet_archive="mise-v$mise_version-macos-$facet_arch.tar.gz"
    curl --fail --location --silent --show-error \
        "https://github.com/jdx/mise/releases/download/v$mise_version/$facet_archive" \
        --output "$facet_download/$facet_archive"
    (cd "$facet_download" && printf '%s  %s\n' "$facet_checksum" "$facet_archive" | shasum -a 256 -c)
    tar -xzf "$facet_download/$facet_archive" -C "$facet_download"
    mkdir -p "$localized_dir"
    mv "$facet_download/mise/bin/mise" "$facet_mise_binary"
fi
exec "$facet_mise_binary" "$@"
