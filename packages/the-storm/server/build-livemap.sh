#!/bin/bash
# Extract the frontend from the already checksum-verified plugin jar. Keep the
# jar and its JavaScript API intact; change only player-visible branding.
set -euo pipefail
export LC_ALL=C

jar=$1
out=$2
branding=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/livemap

fail() {
  echo "[build-livemap] $*" >&2
  exit 1
}

mkdir -p "$out"
[[ -z $(find "$out" -mindepth 1 -maxdepth 1 -print -quit) ]] ||
  fail "output directory must be empty"
webapp=$(mktemp)
trap 'rm -f -- "$webapp"' EXIT
unzip -p "$jar" de/bluecolored/bluemap/webapp.zip >"$webapp"
# Do not extract sql.php, settings, or map data into the owned frontend.
unzip -q "$webapp" index.html 'assets/*' 'lang/*' -d "$out"

scripts=("$out"/assets/index-*.js)
manifests=("$out"/assets/manifest-*.webmanifest)
[[ ${#scripts[@]} == 1 && -f ${scripts[0]} ]] || fail "unexpected viewer entrypoints"
[[ ${#manifests[@]} == 1 && -f ${manifests[0]} ]] || fail "unexpected viewer manifests"
script=${scripts[0]}
manifest=${manifests[0]}
grep -qF '<title>BlueMap</title>' "$out/index.html" || fail "unexpected viewer title"
grep -qE 'rel="icon" href="\./assets/favicon-[[:alnum:]_-]+\.png"' "$out/index.html" || fail "unexpected viewer icon"
grep -qF 'name="og:image" content="' "$out/index.html" || fail "unexpected viewer preview image"
grep -qF '</head>' "$out/index.html" || fail "unexpected viewer document head"
grep -qF 'Failed to load BlueMap webapp!' "$script" || fail "unexpected viewer error message"
grep -qF 'bluemap-screenshot.png' "$script" || fail "unexpected screenshot filename"
[[ $(grep -oF './lang/' "$script" | wc -l) -eq 2 ]] || fail "unexpected language loader"

# Ship The Storm's owned icon and social image with hashed URLs, including the
# installed application's icon. Keep upstream images used by its credit panel.
favicon_hash=$(sha256sum "$branding/favicon.svg" | cut -d ' ' -f 1)
favicon_name=livemap-icon-${favicon_hash:0:16}.svg
install -m 0644 "$branding/favicon.svg" "$out/assets/$favicon_name"
# Ship the preview with this release; no external repository revision can leave
# the live viewer displaying an older brand image.
preview_hash=$(sha256sum "$branding/social.png" | cut -d ' ' -f 1)
preview_name=livemap-social-${preview_hash:0:16}.png
install -m 0644 "$branding/social.png" "$out/assets/$preview_name"
preview_url="https://bluemap.ts-mc.net/assets/$preview_name"
for size in 180 192 512; do
  icon_hash=$(sha256sum "$branding/icon-$size.png" | cut -d ' ' -f 1)
  icon_name=livemap-app-$size-${icon_hash:0:16}.png
  install -m 0644 "$branding/icon-$size.png" "$out/assets/$icon_name"
  case $size in
    180) touch_icon=$icon_name ;;
    192) app_icon_192=$icon_name ;;
    512) app_icon_512=$icon_name ;;
  esac
done

for locale in "$out"/lang/*.conf; do
  [[ ${locale##*/} == settings.conf ]] && continue
  grep -q 'pageTitle: "BlueMap ' "$locale" || fail "unexpected localized viewer title"
  # Keep the BlueMap credit in each locale's Info panel.
  sed 's/^\([[:space:]]*pageTitle: "\)BlueMap/\1LiveMap/' "$locale" >"$locale.branded"
  mv -- "$locale.branded" "$locale"
done

# Hash both the branded translations and changed entrypoints so an existing
# browser never combines cached default branding with the current frontend.
language_hash=$(cd "$out/lang" && sha256sum ./*.conf | sha256sum | cut -d ' ' -f 1)
language_dir=livemap-lang-${language_hash:0:16}
mv -- "$out/lang" "$out/$language_dir"
sed -e 's/Failed to load BlueMap webapp!/Failed to load LiveMap!/g' \
  -e 's/bluemap logo/LiveMap logo/g' \
  -e 's/bluemap-screenshot.png/livemap-screenshot.png/g' \
  -e "s|\./lang/|./$language_dir/|g" \
  "$script" >"$script.branded"
script_hash=$(sha256sum "$script.branded" | cut -d ' ' -f 1)
script_name=livemap-${script_hash:0:16}.js
mv -- "$script.branded" "$out/assets/$script_name"
rm -- "$script"

sed 's/BlueMap/LiveMap/g' "$manifest" |
  jq --arg small "$app_icon_192" --arg large "$app_icon_512" \
    '.icons = [{src: $small, sizes: "192x192", type: "image/png"}, {src: $large, sizes: "512x512", type: "image/png"}]' >"$manifest.branded"
manifest_hash=$(sha256sum "$manifest.branded" | cut -d ' ' -f 1)
manifest_name=livemap-${manifest_hash:0:16}.webmanifest
mv -- "$manifest.branded" "$out/assets/$manifest_name"
rm -- "$manifest"

sed -e 's/BlueMap/LiveMap/g' -e 's/bluemap, map/livemap, map/g' \
  -e "s|assets/favicon-[[:alnum:]_-]*\.png|assets/$favicon_name|g" \
  -e "s|\(name=\"og:image\" content=\"\)[^\"]*|\1$preview_url|g" \
  -e 's|name="og:|property="og:|g' \
  -e "s|</head>|<meta property=\"og:image:width\" content=\"1200\"><meta property=\"og:image:height\" content=\"630\"><meta property=\"og:image:alt\" content=\"The Storm LiveMap, with its original wordmark and archived spawn\"><meta name=\"twitter:card\" content=\"summary_large_image\"><meta name=\"twitter:image\" content=\"$preview_url\"><link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"./assets/$touch_icon\"></head>|" \
  -e "s|assets/index-[[:alnum:]_-]*\.js|assets/$script_name|g" \
  -e "s|assets/manifest-[[:alnum:]_-]*\.webmanifest|assets/$manifest_name|g" \
  "$out/index.html" >"$out/index.html.branded"
mv -- "$out/index.html.branded" "$out/index.html"
