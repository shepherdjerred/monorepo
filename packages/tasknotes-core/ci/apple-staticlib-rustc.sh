#!/usr/bin/env bash
#
# rustc wrapper for the macOS cross-compiler image.
#
# Cargo asks rustc `--print=file-names` once per crate type, including
# `cdylib`, and the answer has to line up with the question. That probe is
# forwarded unchanged.
#
# The real compile drops `cdylib`. Apple apps link the static archive. The
# image's osxcross clang can link a macOS dylib, but it has no iPhoneOS or
# iPhoneSimulator SDK, and Zig 0.13 rejects the export-list flag Rust 1.98
# passes, so an iOS cdylib link cannot succeed here. The Windows cdylib is
# built on its own lane.

set -euo pipefail

compiler="${1}"
shift

passthrough=0
for arg in "$@"; do
  case "${arg}" in
    --print | --print=*) passthrough=1 ;;
  esac
done
if [[ "${passthrough}" == 1 ]]; then
  exec "${compiler}" "$@"
fi

args=()
skip_next=0
for arg in "$@"; do
  if [[ "${skip_next}" == 1 ]]; then
    skip_next=0
    if [[ "${arg}" != "cdylib" ]]; then
      args+=("--crate-type" "${arg}")
    fi
    continue
  fi
  if [[ "${arg}" == "--crate-type" ]]; then
    skip_next=1
    continue
  fi
  args+=("${arg}")
done

exec "${compiler}" "${args[@]}"
