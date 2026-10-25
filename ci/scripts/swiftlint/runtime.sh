#!/bin/sh
# Scope Swift's runtime lookup to this tool, never the caller's other tools.
set -eu
runtime_launcher=$(readlink -f "$0")
runtime=$(dirname "$runtime_launcher")
export LINUX_SOURCEKIT_LIB_PATH="$runtime/lib/libsourcekitdInProc.so"
export LD_LIBRARY_PATH="$runtime/lib"
exec "$runtime/bin/swiftlint" "$@"
