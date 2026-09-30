#!/usr/bin/env bash
# Compare a Linux-built app bundle with the Xcode-built one, on macOS.
#
#   scripts/compare-bundles.sh <xcode.app> <linux.app>
#
# Checks what distinguishes a faithful build rather than what merely differs
# by construction: the file tree, every Info.plist, each Mach-O's
# architectures, linked libraries, rpaths, and LC_BUILD_VERSION, and that the Linux
# bundle's signature is valid. Keys that name the build host
# (`BuildMachineOSBuild`) and the code signature itself are excluded: the
# reference is built unsigned on a Mac.
#
# Linked libraries are compared as a set. Their order is reported but not
# failed: Xcode's linker lists libraries an object autolinks where it loads
# that object, while ld64 lists them after the command line's.
set -euo pipefail

reference=$1
candidate=$2
status=0
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

section() { printf '\n== %s\n' "$1"; }
# report <label>: compares $work/a with $work/b, which the caller filled.
report() {
  if diff "$work/a" "$work/b" > "$work/diff"; then
    echo "identical: $1"
  else
    echo "DIFFERENT: $1"; cat "$work/diff"; status=1
  fi
}

tree() { (cd "$1" && find . -not -path '*/_CodeSignature*' | sort); }
section "file tree"
tree "$reference" > "$work/a"; tree "$candidate" > "$work/b"; report "file tree"

section "Info.plist files"
while IFS= read -r plist; do
  normalized() { plutil -convert json -o - "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); d.pop("BuildMachineOSBuild",None); print(json.dumps(d,indent=1,sort_keys=True))'; }
  normalized "$reference/$plist" > "$work/a"; normalized "$candidate/$plist" > "$work/b"; report "$plist"
done < <(cd "$reference" && find . -name Info.plist -not -path '*/_CodeSignature*' | sort)

section "Mach-O load commands and build versions"
while IFS= read -r binary; do
  archs() { lipo -archs "$1" | tr ' ' '\n' | sort; }
  archs "$reference/$binary" > "$work/a"; archs "$candidate/$binary" > "$work/b"; report "$binary architectures"
  for arch in $(comm -12 "$work/a" "$work/b"); do
    dylibs() { otool -arch "$arch" -L "$1" | grep -v ':$' | sed 's/^[[:space:]]*//'; }
    version() { otool -arch "$arch" -l "$1" | grep -A4 LC_BUILD_VERSION | grep -E 'platform|minos|sdk' | tr -s ' '; }
    rpaths() { otool -arch "$arch" -l "$1" | grep -A2 LC_RPATH | awk '$1 == "path" { print $2 }'; }
    dylibs "$reference/$binary" > "$work/ordered-a"; dylibs "$candidate/$binary" > "$work/ordered-b"
    sort "$work/ordered-a" > "$work/a"; sort "$work/ordered-b" > "$work/b"
    same_set=false; cmp -s "$work/a" "$work/b" && same_set=true
    report "$binary ($arch) linked libraries"
    if $same_set && ! cmp -s "$work/ordered-a" "$work/ordered-b"; then
      echo "note: $binary ($arch) lists the same libraries in a different order"
    fi
    version "$reference/$binary" > "$work/a"; version "$candidate/$binary" > "$work/b"; report "$binary ($arch) LC_BUILD_VERSION"
    rpaths "$reference/$binary" > "$work/a"; rpaths "$candidate/$binary" > "$work/b"; report "$binary ($arch) rpaths"
  done
done < <(cd "$reference" && find . -type f -perm -u+x -not -path '*/_CodeSignature*' -exec sh -c 'file -b "$1" | grep -q Mach-O && echo "$1"' _ {} \; | sort)

section "signature"
if codesign --verify --deep --strict "$candidate" 2>&1; then echo "valid: codesign --verify --deep --strict"; else status=1; fi

exit $status
