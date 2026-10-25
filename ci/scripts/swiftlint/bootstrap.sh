#!/usr/bin/env bash
# Repair stale CI images through the existing remote BuildKit producer.
set -euo pipefail
if [[ $(uname -s) != Linux ]]; then
  echo "SwiftLint CI bootstrap requires a Linux container" >&2
  exit 1
fi
swiftlint_scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
swiftlint_repository=$(cd "$swiftlint_scripts/../../.." && pwd)
swiftlint_pins="$swiftlint_scripts/pins.json"
swiftlint_version=$(python3 "$swiftlint_scripts/validate-inputs.py" "$swiftlint_repository")
swiftlint_config="$swiftlint_repository/packages/tasknotes-macos/.swiftlint.yml"

if command -v swiftlint >/dev/null; then
  # A corrupt executable fails at its actual boundary instead of triggering an
  # automatic replacement that hides the failure.
  swiftlint_current_version=$(swiftlint version)
  if [[ "$swiftlint_current_version" == "$swiftlint_version" ]]; then
    bash "$swiftlint_scripts/verify-capabilities.sh" "$(command -v swiftlint)" "$swiftlint_config" "$swiftlint_version"
    exit 0
  fi
fi
case $(uname -m) in
  x86_64) swiftlint_platform=linux/amd64 ;;
  aarch64) swiftlint_platform=linux/arm64 ;;
  *) echo "Unsupported SwiftLint CI build architecture" >&2; exit 1 ;;
esac
swiftlint_build=$(mktemp -d)
swiftlint_builder="facet-swiftlint-$(python3 -c 'import uuid; print(uuid.uuid4())')"
swiftlint_builder_created=false
swiftlint_cleanup() {
  local status=$?
  if [[ "$swiftlint_builder_created" == true ]]; then
    if ! env -u OP_SERVICE_ACCOUNT_TOKEN docker buildx rm --keep-daemon "$swiftlint_builder"; then
      echo "Could not retire the owned SwiftLint Buildx client" >&2
      if [[ "$status" == 0 ]]; then status=1; fi
    fi
  fi
  rm -rf "$swiftlint_build"
  exit "$status"
}
trap swiftlint_cleanup EXIT
mkdir -p "$swiftlint_build/context" "$swiftlint_build/export"
# Copy exact producer inputs only. Personal/untracked/native artifacts are never
# offered to BuildKit, even if the caller's workspace has a permissive ignore file.
for swiftlint_input in \
  ci/ci-image/Dockerfile \
  ci/scripts/swiftlint/pins.json \
  ci/scripts/swiftlint/extract-source.py \
  ci/scripts/swiftlint/runtime-libraries.txt \
  ci/scripts/swiftlint/runtime.sh \
  ci/scripts/swiftlint/verify-capabilities.sh \
  packages/tasknotes-macos/.swiftlint.yml \
  packages/tasknotes-macos/.swiftlint-appkit-baseline.json; do
  mkdir -p "$swiftlint_build/context/$(dirname "$swiftlint_input")"
  cp "$swiftlint_repository/$swiftlint_input" "$swiftlint_build/context/$swiftlint_input"
done
# Record ownership before the external call: a transport failure can occur
# after Buildx writes its local client record. The unique name is never adopted.
swiftlint_builder_created=true
env -u OP_SERVICE_ACCOUNT_TOKEN docker buildx create --name "$swiftlint_builder" --driver remote \
  tcp://buildkitd-buildkitd-service.buildkitd.svc.cluster.local:1234
env -u OP_SERVICE_ACCOUNT_TOKEN docker buildx build --builder "$swiftlint_builder" --platform "$swiftlint_platform" \
  --file "$swiftlint_build/context/ci/ci-image/Dockerfile" \
  --target swiftlint-export --output "type=local,dest=$swiftlint_build/export" \
  "$swiftlint_build/context"
# Match the minimal runtime stage without replacing the host distribution.
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates libcurl4 libxml2 libstdc++6 libgcc-s1 libatomic1 \
  zlib1g libtinfo6 libedit2 libsqlite3-0 libz3-4 python3
swiftlint_installed=$(python3 "$swiftlint_scripts/install-runtime.py" "$swiftlint_build/export" "$swiftlint_pins" /opt/facet-swiftlint)
bash "$swiftlint_scripts/verify-capabilities.sh" "$swiftlint_installed/swiftlint" "$swiftlint_config" "$swiftlint_version"
swiftlint_link=$(mktemp /usr/local/bin/.swiftlint-XXXXXXXX)
rm "$swiftlint_link"
ln -s "$swiftlint_installed/swiftlint" "$swiftlint_link"
mv -Tf "$swiftlint_link" /usr/local/bin/swiftlint
echo "SwiftLint runtime installed from the checksum-bound remote producer"
