#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
package_directory="$(pwd)"

pause_for() {
  word_count="$(printf '%s' "$1" | wc -w | tr -d '[:space:]')"
  seconds=$(((word_count + 3) / 4))

  if ((seconds < 2)); then
    seconds=2
  elif ((seconds > 12)); then
    seconds=12
  fi

  sleep "$seconds"
}

section() {
  printf '\033[2J\033[H\033[1;36m━━━ %s ━━━\033[0m\n%s\n' "$1" "$2"
  pause_for "$1 $2"
}

section \
  "Helm values -> a checked TypeScript contract" \
  ""

section \
  "1/4  A chart starts as untyped YAML" \
  "Helm accepts values, but your editor cannot tell a boolean from a quoted string."
printf '%s\n' \
  '$ helm show values argo-cd \' \
  '    --repo https://argoproj.github.io/argo-helm \' \
  '    --version 7.7.16 | bat --language yaml'
values_preview="$(helm show values argo-cd \
  --repo https://argoproj.github.io/argo-helm \
  --version 7.7.16 \
  | sed -n '/^server:/,/^repoServer:/p' \
  | sed -n '1,16p')"
printf '%s\n' "$values_preview" \
  | bat --color=always --language=yaml --paging=never --plain --style=numbers
pause_for "$values_preview"

section \
  "2/4  Generate the matching server type" \
  "helm-types preserves the chart's structure, comments, and boolean fields."
printf '%s\n' \
  '$ helm-types --name argo-cd \' \
  '    --repo https://argoproj.github.io/argo-helm \' \
  '    --version 7.7.16 | sed -n 3456,3474p'
generated_type_preview="$(node dist/cli.js \
  --name argo-cd \
  --repo https://argoproj.github.io/argo-helm \
  --version 7.7.16 \
  | sed -n '3456,3474p')"
printf '%s\n' "$generated_type_preview" \
  | bat --color=always --language=typescript --paging=never --plain --style=numbers
pause_for "$generated_type_preview"

section \
  "3/4  See the compiler reject an invalid override" \
  "This temporary file imports the generated type and deliberately passes a string for replicas."
demo_directory="$(mktemp -d -t helm-types-demo)"
trap 'rm -r -- "$demo_directory"' EXIT
generated_types="$demo_directory/argo-cd-values.ts"
invalid_values="$demo_directory/values.ts"
diagnostics="$demo_directory/diagnostics.txt"
node dist/cli.js \
  --name argo-cd \
  --repo https://argoproj.github.io/argo-helm \
  --version 7.7.16 \
  --output "$generated_types" \
  >/dev/null
printf '%s\n' \
  'import type { ArgoCdHelmValues } from "./argo-cd-values.js";' \
  '' \
  'const values: ArgoCdHelmValues = { server: { replicas: "two" } };' \
  >"$invalid_values"
printf '\033[2m$ bat values.ts\033[0m\n'
invalid_values_preview="$(<"$invalid_values")"
printf '%s\n' "$invalid_values_preview" \
  | bat --color=always --language=typescript --paging=never --plain --style=numbers
pause_for "$invalid_values_preview"
printf '\033[2m$ tsc --noEmit values.ts\033[0m\n'
if (
  cd "$demo_directory"
  PATH="$package_directory/node_modules/@typescript/native/bin:$PATH" tsc \
    --noEmit \
    --ignoreConfig \
    --strict \
    --module NodeNext \
    --moduleResolution NodeNext \
    --target ES2024 \
    values.ts
) >"$diagnostics" 2>&1; then
  printf '\033[1;31mExpected the invalid override to fail type checking.\033[0m\n' >&2
  exit 1
fi
diagnostic_preview="$(<"$diagnostics")"
printf '%s\n' "$diagnostic_preview" \
  | bat --color=always --language=typescript --paging=never --plain --style=numbers
pause_for "$diagnostic_preview"

section \
  "4/4  Correct the value before Helm runs" \
  "The generated contract makes the safe edit explicit in the editor and CI."
printf '\033[2m$ delta --color-only --paging never\033[0m\n'
diff_preview="$(printf '%s\n' \
  'diff --git a/values.ts b/values.ts' \
  '--- a/values.ts' \
  '+++ b/values.ts' \
  '@@ -1,3 +1,5 @@' \
  '-const values = { server: { replicas: "two" } };' \
  '+const values: ArgoCdHelmValues = {' \
  '+  server: { replicas: 2 },' \
  '+};' \
  ' ' \
  '-// Helm only sees a string at apply time.' \
  '+// TypeScript now rejects the quoted number before deployment.')"
printf '%s\n' "$diff_preview" \
  | delta \
    --color-only \
    --paging=never \
    --syntax-theme Dracula \
    --minus-style 'red bold' \
    --minus-emph-style 'red bold' \
    --plus-style 'green bold' \
    --plus-emph-style 'green bold' \
    --zero-style dim
pause_for "$diff_preview"
printf '\n\033[1;32m✓ Same chart values, with feedback where you write them.\033[0m\n'
