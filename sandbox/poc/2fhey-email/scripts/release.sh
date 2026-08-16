#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
release_dir="${RELEASE_DIR:-$project_dir/dist}"
signing_identity="${CODE_SIGN_IDENTITY:-Developer ID Application}"
notary_profile="${NOTARY_PROFILE:-}"
release_started_at=$(date +%s)

log_event() {
    event="$1"
    shift
    print -u2 -- "$(date -u +%Y-%m-%dT%H:%M:%SZ) event=$event $*"
}

: "${DEVELOPMENT_TEAM:?Set DEVELOPMENT_TEAM to the Apple Developer Team ID}"
if [[ -z "$notary_profile" ]]; then
    print -u2 "Set NOTARY_PROFILE to an xcrun notarytool keychain profile name"
    exit 1
fi

if [[ -e "$release_dir/MailMateCodeFill.zip" ]]; then
    print -u2 "Refusing to overwrite $release_dir/MailMateCodeFill.zip; choose a new RELEASE_DIR or remove the old artifact"
    exit 1
fi

log_event release_started release_dir="$release_dir"

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mailmate-codefill-release.XXXXXX")"
trap 'rm -rf "$temp_dir"' EXIT

mkdir -p "$release_dir"
if [[ "${REGENERATE_PROJECT:-0}" == "1" ]]; then
    xcodegen generate --spec "$project_dir/project.yml"
    log_event project_generated
else
    log_event project_generation_skipped using_xcode_project=1
fi
xcodebuild \
    -allowProvisioningUpdates \
    -project "$project_dir/MailMateCodeFill.xcodeproj" \
    -scheme MailMateCodeFill \
    -configuration Release \
    -archivePath "$temp_dir/MailMateCodeFill.xcarchive" \
    DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
    CODE_SIGN_IDENTITY="$signing_identity" \
    CODE_SIGN_STYLE=Manual \
    ENABLE_HARDENED_RUNTIME=YES \
    archive
log_event archive_created

app_path="$temp_dir/MailMateCodeFill.xcarchive/Products/Applications/MailMateCodeFill.app"
if [[ ! -d "$app_path" ]]; then
    print -u2 "Archive did not contain $app_path"
    exit 1
fi

/usr/bin/codesign --verify --deep --strict --verbose=2 "$app_path"
log_event signature_verified
submitted_zip="$temp_dir/MailMateCodeFill-submission.zip"
/usr/bin/ditto -c -k --keepParent "$app_path" "$submitted_zip"
log_event notarization_submit_started
xcrun notarytool submit "$submitted_zip" --keychain-profile "$notary_profile" --wait
log_event notarization_accepted
xcrun stapler staple "$app_path"
xcrun stapler validate "$app_path"
spctl --assess --type execute --verbose=2 "$app_path"
log_event notarization_stapled

/usr/bin/ditto "$app_path" "$release_dir/MailMateCodeFill.app"
/usr/bin/ditto -c -k --keepParent "$app_path" "$release_dir/MailMateCodeFill.zip"
print "Created $release_dir/MailMateCodeFill.app"
print "Created $release_dir/MailMateCodeFill.zip"
log_event release_finished duration_s=$(( $(date +%s) - release_started_at ))
