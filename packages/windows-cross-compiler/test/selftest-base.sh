#!/bin/bash
# Builds the C, C++, Rust, and .NET samples for x64 and ARM64 Windows and
# checks that each output is a Windows executable for the requested machine.
set -euo pipefail

samples=$1
out=$(mktemp -d)

expect_pe() {
  local file=$1 machine=$2 description
  description=$(file -b "$file")
  if [[ $description != "PE32+ executable"*"$machine"*"for MS Windows"* ]]; then
    echo "selftest: $file is '$description', expected a PE32+ $machine Windows executable" >&2
    exit 1
  fi
  echo "ok: $file ($description)"
}

for target in x86_64-pc-windows-msvc aarch64-pc-windows-msvc; do
  case $target in
    x86_64-*) machine=x86-64 rid=win-x64 ;;
    aarch64-*) machine=Aarch64 rid=win-arm64 ;;
  esac

  "$target-cl" /nologo "$samples/c/hello.c" "/Fe$out/hello-c-$target.exe" "/Fo$out/"
  expect_pe "$out/hello-c-$target.exe" "$machine"

  "$target-cl" /nologo /EHsc "$samples/cpp/hello.cpp" "/Fe$out/hello-cpp-$target.exe" "/Fo$out/"
  expect_pe "$out/hello-cpp-$target.exe" "$machine"

  cargo xwin build --quiet --release --locked \
    --manifest-path "$samples/rust/Cargo.toml" --target "$target" --target-dir "$out/rust"
  expect_pe "$out/rust/$target/release/hello-windows.exe" "$machine"

  dotnet publish "$samples/dotnet-console/HelloWindows.csproj" --nologo --verbosity quiet \
    --configuration Release --runtime "$rid" --self-contained false --output "$out/dotnet-$rid"
  expect_pe "$out/dotnet-$rid/HelloWindows.exe" "$machine"
done
