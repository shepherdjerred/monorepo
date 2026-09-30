#!/bin/bash
# Builds and packages the WinUI sample for x64 and ARM64 and checks the MSIX:
# a Windows executable for the platform, a generated manifest and block map,
# and the compiled XAML (XBF) embedded in resources.pri.
set -euo pipefail

samples=$1
out=$(mktemp -d)

for platform in x64 ARM64; do
  case $platform in
    x64) rid=win-x64 machine=x86-64 ;;
    ARM64) rid=win-arm64 machine=Aarch64 ;;
  esac

  dotnet build "$samples/winui/HelloWinUI.csproj" --nologo --configuration Release \
    --runtime "$rid" -p:Platform="$platform" \
    -p:GenerateAppxPackageOnBuild=true -p:AppxPackageDir="$out/$platform/"

  msix=$(find "$out/$platform" -name 'HelloWinUI_*.msix' | head -n 1)
  if [[ -z $msix ]]; then
    echo "selftest: no MSIX was produced for $platform" >&2
    exit 1
  fi
  contents="$out/$platform/contents"
  unzip -q "$msix" -d "$contents"

  for entry in AppxManifest.xml AppxBlockMap.xml '[Content_Types].xml' resources.pri HelloWinUI.exe HelloWinUI.dll; do
    if [[ ! -f "$contents/$entry" ]]; then
      echo "selftest: $msix is missing $entry" >&2
      exit 1
    fi
  done

  description=$(file -b "$contents/HelloWinUI.exe")
  if [[ $description != "PE32+ executable"*"$machine"* ]]; then
    echo "selftest: HelloWinUI.exe is '$description', expected $machine" >&2
    exit 1
  fi

  # App.xaml, MainWindow.xaml, and Views/GreetingView.xaml compile to XBF.
  xbf_count=$(grep -a -o -P 'XBF\x00' "$contents/resources.pri" | wc -l)
  if (( xbf_count < 3 )); then
    echo "selftest: resources.pri embeds $xbf_count XBF files, expected 3" >&2
    exit 1
  fi
  if ! grep -q 'ProcessorArchitecture="'"${platform,,}"'"' "$contents/AppxManifest.xml"; then
    echo "selftest: AppxManifest.xml does not declare ${platform,,}" >&2
    exit 1
  fi
  echo "ok: $msix ($description, $xbf_count XBF)"
done
