#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

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
  "Home Assistant -> a typed client" \
  ""

section \
  "1/4  Start with runtime API data" \
  "Entity IDs, service fields, and events begin as JSON from Home Assistant."
fixture_summary="$(jq -C '{
  entity_id: .states[0].entity_id,
  state: .states[0].state,
  service: "light.turn_on",
  field: { brightness: "number (optional)" },
  event: .events[0].event
}' demos/home-assistant-fixture.json)"
printf '\033[2m$ jq -C <selected fields> demos/home-assistant-fixture.json\033[0m\n%s\n' "$fixture_summary"
pause_for "$fixture_summary"

section \
  "2/4  Generate the instance schema" \
  "ha-codegen reads that API and emits a normal TypeScript module."
printf '\033[2m$ node examples/codegen-fixture.mjs | bat --language ts\033[0m\n'
generated_schema_preview="$(node examples/codegen-fixture.mjs | sed -n '6,25p')"
printf '%s\n' "$generated_schema_preview" \
  | bat --color=always --language=typescript --paging=never --plain --style=numbers \
    --line-range 1:20
pause_for "$generated_schema_preview"

section \
  "3/4  See the compiler reject a mistyped entity" \
  "This temporary client imports the emitted HaSchema and deliberately misspells the entity ID."
demo_directory="$(mktemp -d -t home-assistant-demo)"
trap 'rm -r -- "$demo_directory"' EXIT
package_directory="$(pwd)"
generated_schema="$demo_directory/ha-schema.ts"
invalid_client="$demo_directory/invalid.ts"
diagnostics="$demo_directory/diagnostics.txt"
node examples/codegen-fixture.mjs >"$generated_schema"
printf '%s\n' \
  "import type { HomeAssistantRestClient } from \"${package_directory}/dist/index.js\";" \
  'import type { HaSchema } from "./ha-schema.js";' \
  '' \
  'declare const client: HomeAssistantRestClient<HaSchema>;' \
  'client.getState("light.demo_lmp");' \
  >"$invalid_client"
printf '\033[2m$ bat invalid.ts\033[0m\n'
invalid_client_preview="$(sed "s#${package_directory}#<package>#g" "$invalid_client")"
printf '%s\n' "$invalid_client_preview" \
  | bat --color=always --language=typescript --paging=never --plain --style=numbers
pause_for "$invalid_client_preview"
printf '\033[2m$ tsc --noEmit invalid.ts\033[0m\n'
if (
  cd "$demo_directory"
  PATH="$package_directory/node_modules/@typescript/native/bin:$PATH" tsc \
    --noEmit \
    --ignoreConfig \
    --strict \
    --module NodeNext \
    --moduleResolution NodeNext \
    --target ES2024 \
    invalid.ts
) >"$diagnostics" 2>&1; then
  printf '\033[1;31mExpected the invalid entity ID to fail type checking.\033[0m\n' >&2
  exit 1
fi
diagnostic_preview="$(<"$diagnostics")"
printf '%s\n' "$diagnostic_preview" \
  | bat --color=always --language=typescript --paging=never --plain --style=numbers
pause_for "$diagnostic_preview"

section \
  "4/4  Correct the entity before the request runs" \
  "The generated schema gives the editor and CI the same precise feedback."
printf '\033[2m$ delta --color-only --paging never\033[0m\n'
diff_preview="$(printf '%s\n' \
  'diff --git a/client.ts b/client.ts' \
  '--- a/client.ts' \
  '+++ b/client.ts' \
  '@@ -3,3 +3,3 @@' \
  ' declare const client: HomeAssistantRestClient<HaSchema>;' \
  '-client.getState("light.demo_lmp");' \
  '+client.getState("light.demo_lamp");' \
  ' ' \
  '-// The typo would become a failing API request.' \
  '+// The typo is corrected before the request can run.')"
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
printf '\n\033[1;32m✓ The generated schema catches the typo before runtime.\033[0m\n'
