# macos-cross-compiler

Build macOS, iOS, and Mac Catalyst software on Linux, with no Mac in the loop.
It covers Swift and SwiftUI apps, SwiftPM packages, C, C++, Objective-C, and
Rust. The output is signed Mach-O binaries and `.app` bundles that match what
Xcode builds from the same sources.

```bash
docker run --rm -v "$PWD:/workspace" ghcr.io/shepherdjerred/macos-cross-compiler:27 \
  arm64-apple-macos-clang hello.c -o hello
```

## Images

There is one image per macOS SDK. The deployment target is independent of
the SDK, so every image builds for macOS 15 and later by default.

| Tag              | SDK (from) | Swift | Status  |
| ---------------- | ---------- | ----- | ------- |
| `:27`, `:latest` | Xcode 27.0 | 6.4   | current |
| `:26`            | Xcode 26   | 6.2   | planned |
| `:15`            | Xcode 16.4 | 6.2   | planned |

[`sdks.json`](sdks.json) is the matrix. Each image uses the Swift that shipped
with its Xcode. The exception is Swift 6.1, which has no Swift Build, so the
`:15` image uses 6.2. Every tag is built for `linux/amd64` and `linux/arm64`
hosts.

The images contain Apple's SDKs, which are subject to the Xcode license
agreement. Complying with it is your responsibility.

## Using it

Mount your sources at `/workspace`. The default deployment targets are macOS
15.0 and iOS 18.0. Override them with `MACOSX_DEPLOYMENT_TARGET` or
`IPHONEOS_DEPLOYMENT_TARGET`.

**C, C++, Objective-C.** Use one wrapper per target:
`<arch>-apple-macos-clang` or `-clang++` (arm64, x86_64),
`arm64-apple-ios-clang`, and `<arch>-apple-ios-macabi-clang` for Mac Catalyst.
Plain `clang --target=arm64-apple-macos15` also works. Combine the per-arch
builds with `lipo -create` for a universal binary.

**Swift.** `<arch>-apple-macos-swiftc main.swift -o hello` compiles directly.
For a package, use SwiftPM:

```bash
swift build --build-system swiftbuild --triple arm64-apple-macosx15.0 --sdk "$MACOS_SDK" -c release
```

`$MACOS_SDK` and `$IOS_SDK` point at the SDKs. Mac Catalyst uses
`--triple arm64-apple-ios18.0-macabi --sdk "$MACOS_SDK"`.

**Apps.** `applebuild` builds an [XcodeGen](https://github.com/yonaskolb/XcodeGen)
`project.yml` application target into a signed `.app` plus its dSYM, as
`xcodebuild` would:

```bash
applebuild project.yml --target MyApp [--platform macos|ios|maccatalyst] \
  [--configuration Release] [--setting KEY=VALUE] --output out
```

Signing is ad-hoc when `CODE_SIGN_IDENTITY` is `-`. To sign with a real
identity, set `APPLEBUILD_P12_FILE` and `APPLEBUILD_P12_PASSWORD_FILE`, plus
`APPLEBUILD_PROVISIONING_PROFILE` for a profile to embed. A target with an
asset catalog or Icon Composer `.icon` needs `--compiled-assets <dir>` holding
Xcode `actool` output.

**Rust.** Cargo's Apple targets are preconfigured, with linker, `cc` and `ar`:
`cargo build --target aarch64-apple-darwin`. The same works for
`x86_64-apple-darwin`, `aarch64-apple-ios`, and `aarch64-apple-ios-macabi`.

## How it works

Nothing reimplements the compiler, and the SDKs are Apple's own. Each piece
uses the mechanism Xcode itself uses:

- **Compiler.** The swift.org Linux toolchain for the image's Swift version,
  plus a Darwin Swift resource directory built from Xcode's toolchain. The
  Linux one's `CoreFoundation` and `Dispatch` module maps would shadow the
  SDK's.
- **Linker.** Apple's open-source `ld64` from
  [cctools-port](https://github.com/tpoechtrager/cctools-port), with Apple's
  libtapi to read the SDK's `.tbd` stubs and LLVM 22's libLTO to read rustc's
  bitcode. Clang reads a configuration file per target triple
  (`/usr/bin/<triple>.cfg`) that supplies the SDK and `ld64`. It therefore
  records the real SDK version in `LC_BUILD_VERSION`, however it is invoked.
- **Package builds.** [Swift Build](https://github.com/swiftlang/swift-build),
  the build engine inside Xcode and SwiftPM's default, reads platforms and SDKs
  from an Xcode-shaped developer directory (`$DEVELOPER_DIR`). Its build
  settings come from a toolchain `Info.plist` scoped to Apple SDKs, the same
  hook Xcode toolchains use.
- **SwiftUI macros.** In recent SDKs, `@State`, `@Entry`, and `#Preview` are
  macros whose plugins ship only as closed-source macOS binaries.
  [`macros/`](macros/) implements them on Linux.
  [`check-against-xcode.sh`](macros/check-against-xcode.sh) runs every fixture
  through Xcode's plugins and through these, and requires identical expansions.
- **Apps.** [`applebuild`](applebuild/) resolves Xcode build settings through
  XcodeGen's and Xcode's own layers. It builds package products with Swift
  Build, embeds dynamic products as frameworks, compiles the app target, and
  assembles the bundle, including the keys Xcode's Info.plist processing adds.
  It signs with [rcodesign](https://github.com/indygreg/apple-platform-rs).

## Building the images

The SDK material is staged from an installed Xcode on a Mac. The staged
tarballs are the only inputs that are not in this repository:

```bash
scripts/stage-xcode.sh --developer-dir /Applications/Xcode.app/Contents/Developer
# → .stage/<sdk>/ and .stage/sdk-<sdk>.tar.zst (+ .sha256)
docker build --build-arg SDK=27 --build-arg SWIFT_IMAGE=swift:6.4.0-noble -t macos-cross-compiler:27 .
docker build --target smoke --build-arg SDK=27 --build-arg SWIFT_IMAGE=swift:6.4.0-noble .
```

The `smoke` stage builds every sample in [`samples/`](samples/) for every
platform and checks each Mach-O's architectures, platform, deployment target,
and recorded SDK. In CI, the tarballs come from a private bucket by the sha256
recorded in `sdks.json`.

To compare an app built here with Xcode's build of the same project, run this
on a Mac:

```bash
scripts/compare-bundles.sh <Xcode-built.app> <Linux-built.app>
```

## Fidelity

These differences from `xcodebuild` output are known:

- **`BuildMachineOSBuild`** is absent. It records the Mac that ran the build,
  and there is none.
- **Asset catalogs, Icon Composer `.icon` files, and storyboards** need Apple's
  `actool` and `ibtool`, which exist only on macOS. Pass the compiled assets
  with `--compiled-assets`. Storyboards are not supported.
- **Re-exported symbols:** some bind to the defining framework rather than
  through a re-export. For example, `NSURLSession` is bound to `CFNetwork`
  rather than via `Foundation`, which adds a `CFNetwork` load command. dyld
  resolves both to the same code.
- **Package deployment targets:** Swift Build compiles every package in the
  graph for the app's deployment target, while Xcode compiles each package for
  its own declared minimum. A package that declares an older minimum therefore
  back-deploys fewer Swift runtime shims here. A dependency on
  KeyboardShortcuts (macOS 12), for example, costs Xcode's TaskNotes build a
  `libc++` load command and adds `LSMinimumSystemVersion` 12.0 to its resource
  bundle, where this build writes 15.0.
- **Package frameworks** (a `type: .dynamic` product) get compatibility
  version 1.0.0 where Xcode writes 0.0.0. They also record the real SDK in
  `LC_BUILD_VERSION`, where Xcode records the package's deployment target.
- **Not supported yet:** `.xcodeproj` projects, Objective-C, C, or Metal
  sources in an XcodeGen app target, simulator SDKs, and running tests.
  Each one fails with an error rather than being skipped.
