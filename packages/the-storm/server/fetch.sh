#!/bin/bash
# Build-time only. Downloads every artifact a manifest pins and fails the build
# on any sha256 mismatch, so the image never contains an unverified file.
#
#   fetch.sh plugins <plugins.json> <out-dir>
#   fetch.sh nav <nav-manifest.json> <out-dir>
#
# `plugins` produces <out>/paper/<file>, <out>/paper-defaults/<file> and
# <out>/plugins/<file>. `nav` produces <out>/<path> for every baked rwf
# navigation mesh the manifest names (lobby/nav.rwfnav, maps/<id>/nav.rwfnav):
# the meshes are not in Git, so the bucket object named by its sha256 is the
# only source, and one that is missing or altered fails the build here.
set -euo pipefail

kind=$1
manifest=$2
out=$3

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

case $kind in
  plugins)
    each '.paper' paper
    each '.paperDefaults[]' paper-defaults
    each '.plugins[]' plugins
    ;;
  nav)
    # The object keeps the mesh's extension: the public site serves no path without one.
    each '{baseUrl} + .objects[] | {url: "\(.baseUrl)/\(.sha256).rwfnav", sha256, file: .path}' .
    ;;
  *)
    echo "usage: fetch.sh plugins|nav <manifest> <out-dir>" >&2
    exit 1
    ;;
esac
