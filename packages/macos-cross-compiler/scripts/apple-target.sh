# Sourced by the <triple>-clang / <triple>-swiftc wrappers: resolves the
# invoked name to an Apple target triple with its deployment version.
#
# Sets: arch, os (macos | ios | macabi), triple (versioned unless the caller
# passes its own -m*-version-min, as rustc and cc-rs do), sdk.

name=$(basename "$0")
case "$name" in
  *-clang++) prefix=${name%-clang++} ;;
  *-clang) prefix=${name%-clang} ;;
  *-swiftc) prefix=${name%-swiftc} ;;
  *) echo "$name: invoke through a <triple>-clang or <triple>-swiftc link" >&2; exit 1 ;;
esac

case "$prefix" in
  aarch64-apple-darwin | arm64-apple-macos) arch=arm64 os=macos ;;
  x86_64-apple-darwin | x86_64-apple-macos) arch=x86_64 os=macos ;;
  aarch64-apple-ios | arm64-apple-ios) arch=arm64 os=ios ;;
  aarch64-apple-ios-macabi | arm64-apple-ios-macabi) arch=arm64 os=macabi ;;
  x86_64-apple-ios-macabi) arch=x86_64 os=macabi ;;
  *) echo "$name: unknown target $prefix" >&2; exit 1 ;;
esac

explicit_minimum=false
for argument in "$@"; do
  case "$argument" in -mmacos*-version-min=* | -mios-version-min=* | -miphoneos-version-min=*) explicit_minimum=true ;; esac
done

case "$os" in
  macos) version=${MACOSX_DEPLOYMENT_TARGET:-15.0} sdk=/opt/apple/sdks/MacOSX.sdk base="$arch-apple-macos" suffix= ;;
  ios) version=${IPHONEOS_DEPLOYMENT_TARGET:-18.0} sdk=/opt/apple/sdks/iPhoneOS.sdk base="$arch-apple-ios" suffix= ;;
  macabi) version=${IPHONEOS_DEPLOYMENT_TARGET:-18.0} sdk=/opt/apple/sdks/MacOSX.sdk base="$arch-apple-ios" suffix=-macabi ;;
esac
if [ "$explicit_minimum" = true ]; then triple="$base$suffix"; else triple="$base$version$suffix"; fi
