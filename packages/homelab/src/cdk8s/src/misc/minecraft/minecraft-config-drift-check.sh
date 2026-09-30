#!/bin/sh
# Semantic config-drift guard for Minecraft servers (config-as-code).
#
# Runs before the copy init container on pod startup. Compares the repo-managed
# ConfigMap sources against the current persistent-volume state and refuses to
# start (exit 1) if any managed config has drifted, so a live edit is never
# silently overwritten by the copy step ("repo always wins").
#
# Why this is SEMANTIC, not a byte compare: Spigot/Paper plugins re-serialize
# their config files on load — mcMMO (Bukkit YamlConfiguration) reindents whole
# files to 4 spaces, others flip quote styles, drop the trailing newline, or
# normalise YAML block/flow style. A byte compare (`cmp`) flags every such file
# on the next boot even though no value changed, which crash-loops the pod and
# is unfixable by an ever-growing ignore list. So for structured files we
# compare the PARSED value (yq → canonical sorted JSON): reformatting passes,
# only a real value change fails. For unstructured files we compare after
# normalising line endings and trailing whitespace.
#
# Usage:
#   minecraft-config-drift-check.sh
#       Compare the production trees: /plugin-configs → /data/plugins and
#       /config → /data.
#   minecraft-config-drift-check.sh SRC DEST [SRC DEST ...]
#       Compare explicit (source-tree, dest-tree) pairs. Used by the tests.
#
#   exit 0 -> in sync (semantically) or fresh PVC (dest files absent)
#   exit 1 -> drift detected (offending files printed)
#   exit 2 -> the check itself could not run
#
# Requires yq (mikefarah) plus busybox coreutils — see the mikefarah/yq image
# pinned in versions.ts.
set -u

# Files that Paper/plugins legitimately REWRITE WITH REAL VALUE CHANGES at
# runtime (version migrations, generated ids, engine-owned settings). These are
# not reformatting, so even the semantic compare would flag them — exclude them
# so a routine server/plugin upgrade does not crash-loop the pod. Paths are
# relative to a source tree (leading "./").
is_ignored() {
  case "$1" in
    ./server.properties | ./spigot.yml | ./config/paper-global.yml | ./config/paper-world-defaults.yml) return 0 ;;
    # Geyser rewrites config.yml with generated values (metrics uuid, resolved
    # remote address).
    ./Geyser-Spigot/config.yml) return 0 ;;
    *) return 1 ;;
  esac
}

# Canonicalise a structured file to compact, key-sorted JSON so that
# reformatting (indentation, quoting, key order, trailing newline, comments)
# collapses to an identical string. Returns non-zero if the file cannot be
# parsed; yq's parse error is left on stderr so the pod log explains the failure.
#   $1 = yq input format (yaml|json)   $2 = file
canonicalize() {
  yq -p="$1" -o=json -I=0 "sort_keys(..)" "$2"
}

# Normalise an unstructured text file: strip CR (CRLF→LF) and trailing
# whitespace per line. Command substitution in the caller also drops trailing
# blank lines. $1 = file.
normalize_text() {
  tr -d '\r' <"$1" | sed "s/[[:space:]]*$//"
}

MARKER="${TMPDIR:-/tmp}/mc-config-drift.$$"
CANON_A="${MARKER}.a"
CANON_B="${MARKER}.b"
rm -f "$MARKER" "$CANON_A" "$CANON_B"

# Compare one source tree against its destination tree.
#   $1 = source dir (repo ConfigMap projection)
#   $2 = destination dir (persistent volume)
compare_tree() {
  src="$1"
  dest_root="$2"

  # Nothing mounted / empty source: nothing to enforce. `$src` is a directory
  # here (guarded above), so `ls -A` cannot error.
  [ -d "$src" ] || return 0
  [ -n "$(ls -A "$src")" ] || return 0

  # `-L` follows the ConfigMap item symlinks; `! -path '*/..*'` skips the
  # `..data` / `..<timestamp>` symlink dirs Kubernetes creates for ConfigMap
  # volumes. Paths are referenced in full (no `cd`) so they resolve correctly
  # inside the pipe's subshell.
  find -L "$src" -type f ! -path "*/..*" | while read -r srcfile; do
    rel="${srcfile#"$src"/}"
    dest="$dest_root/$rel"

    # Not on the volume yet (fresh PVC / newly added file): nothing to compare;
    # the copy step will seed it.
    [ -f "$dest" ] || continue

    # Fast path: byte-identical means definitely in sync — skip the parse.
    if cmp -s "$srcfile" "$dest"; then
      continue
    fi

    if is_ignored "./$rel"; then
      echo "IGNORED (runtime-modified): ./$rel"
      continue
    fi

    case "$rel" in
    *.yml | *.yaml) fmt=yaml ;;
    *.json) fmt=json ;;
    *)
      # Unstructured: compare after normalising line endings / trailing space.
      if [ "$(normalize_text "$srcfile")" = "$(normalize_text "$dest")" ]; then
        echo "OK reformatted (whitespace/newlines): ./$rel"
      else
        echo "DRIFT DETECTED: ./$rel differs from repo (text) [$dest]"
        touch "$MARKER"
      fi
      continue
      ;;
    esac

    # Structured: compare the parsed value, not the bytes.
    if ! canonicalize "$fmt" "$srcfile" >"$CANON_A"; then
      echo "DRIFT DETECTED: ./$rel is not valid $fmt in the repo ConfigMap"
      touch "$MARKER"
      continue
    fi
    if ! canonicalize "$fmt" "$dest" >"$CANON_B"; then
      echo "DRIFT DETECTED: ./$rel is not valid $fmt on the volume [$dest]"
      touch "$MARKER"
      continue
    fi

    if cmp -s "$CANON_A" "$CANON_B"; then
      # Byte-different but semantically identical: plugin reformatting only.
      echo "OK reformatted ($fmt, no semantic change): ./$rel"
    else
      echo "DRIFT DETECTED: ./$rel differs from repo ($fmt values) [$dest]"
      diff "$CANON_A" "$CANON_B" | head -20
      echo "---"
      touch "$MARKER"
    fi
  done
}

echo "=== Config drift check ==="

if [ "$#" -gt 0 ]; then
  # Explicit (src, dest) pairs.
  if [ $(($# % 2)) -ne 0 ]; then
    echo "ERROR: expected an even number of SRC DEST arguments" >&2
    rm -f "$CANON_A" "$CANON_B"
    exit 2
  fi
  while [ "$#" -ge 2 ]; do
    compare_tree "$1" "$2"
    shift 2
  done
else
  # Production defaults: plugin configs and non-plugin (flat) configs.
  compare_tree /plugin-configs /data/plugins
  compare_tree /config /data
fi

rm -f "$CANON_A" "$CANON_B"

if [ -f "$MARKER" ]; then
  rm -f "$MARKER"
  echo ""
  echo "=== CONFIG DRIFT DETECTED ==="
  echo "Managed config on the server differs from the repo (real value change,"
  echo "not just plugin reformatting)."
  echo "To fix: update the repo config to match (or revert the live change),"
  echo "commit, and redeploy. Refusing to start."
  exit 1
fi

echo "=== All managed configs match the repo (semantically) ==="
