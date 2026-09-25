#!/bin/bash
# Build-time only. Downloads every artifact pinned in plugins.json and fails the
# build on any sha256 mismatch, so the image never contains an unverified jar.
#
#   fetch.sh <plugins.json> <out-dir>
#
# Produces <out>/paper/<file>, <out>/paper-defaults/<file> and <out>/plugins/<file>.
set -euo pipefail

manifest=$1
out=$2

fetch() { # url sha256 dest
  mkdir -p "$(dirname "$3")"
  curl --fail --silent --show-error --location --retry 5 --retry-all-errors \
    --output "$3" "$1"
  echo "$2  $3" | sha256sum --check --strict -
}

each() { # jq-filter dest-subdir
  jq -r "$1 | [.url, .sha256, .file] | @tsv" "$manifest" |
    while IFS=$'\t' read -r url sha file; do
      fetch "$url" "$sha" "$out/$2/$file"
    done
}

each '.paper' paper
each '.paperDefaults[]' paper-defaults
each '.plugins[]' plugins
