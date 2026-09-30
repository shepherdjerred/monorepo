---
title: Why macos-cross-compiler builds like Xcode
description: How the macos-cross-compiler images produce Xcode-identical macOS and iOS apps on Linux, and why each piece is Apple's own mechanism rather than an imitation.
sidebar:
  order: 12
---

The macos-cross-compiler images build macOS, iOS, and Mac Catalyst software on
Linux. Their output matches what Xcode produces from the same sources: the
same bundle layout, Info.plists, load commands, and recorded SDK. They manage
this by running Apple's own mechanisms wherever those exist, and reimplementing
only what Apple ships solely as closed macOS binaries. This page explains that
design and the alternatives it replaced. The package README in
`packages/macos-cross-compiler` covers usage and the exact list of remaining
differences.

## Faithful beats compatible

The 2023 version of this project was built on osxcross. It compiled C, C++,
Fortran, and Rust. It could not build a SwiftUI app, and nothing checked its
output against Xcode's. The revival starts from a stricter goal: a Linux build
should be indistinguishable from an Xcode build of the same project. That goal
is testable. `compare-bundles.sh` diffs a Linux-built app against an
`xcodebuild` one, file by file and load command by load command. The goal also
settles most design questions. When there is a choice between an
approximation and the component Xcode itself uses, the image uses Xcode's.

## The pieces, and why each is the one Xcode uses

**Apple's SDKs and the upstream Swift compiler.** Swift is open source. The
swift.org Linux toolchain is the same compiler Xcode ships, and it reads the
SDK's `.swiftinterface` files. The one trap is the resource directory. The
Linux toolchain's own `usr/lib/swift` holds Linux module maps for
`CoreFoundation` and `Dispatch`. Those shadow the SDK's modules and break the
Clang importer in confusing ways. The image therefore gives Darwin targets a
resource directory assembled from Xcode's toolchain instead.

**Apple's linker, not LLVM's.** `ld64.lld` links most Mach-O well, but it fails
in two places that matter.

- It rejects Mac Catalyst links, because the SDK's `libSystem` re-exports
  macOS-only libraries that Apple's linker quietly skips.
- It does not implement `ld -r`, which Xcode's package builds rely on.

Apple publishes `ld64` as open source. The cctools-port build, with Apple's
libtapi for `.tbd` stubs, handles both cases. That single change made the
Catalyst output identical to Xcode's.

**Clang configuration files carry the Darwin defaults.** A cross-compiling
clang needs the SDK, the linker, and Catalyst's search paths for every Darwin
invocation. Those invocations come from many directions: users, cargo's cc
crate, Swift Build, and the links `swiftc` drives. Wrapping each caller would
miss some. Clang instead reads `/usr/bin/<triple>.cfg` for the unversioned
target triple, whoever invokes it. That is also why the recorded SDK version
comes out right. Clang records the SDK only when it sees `-isysroot`, and the
Swift driver passes `--sysroot` when it runs on Linux.

**Swift Build sees the real SDK.** SwiftPM's default build engine is Swift
Build, the engine inside Xcode. SwiftPM can hand it a Swift SDK bundle, but
Swift Build then synthesizes an SDK record without the Apple SDK's
`SDKSettings`. It concludes the target produces ELF, not Mach-O. The symptoms
look unrelated: `.so` dylibs, an ELF-only autolink step, a lost Catalyst
variant, and placeholder Xcode versions. The fix is to stop synthesizing. The
image lays out an Xcode-shaped developer directory, holding the platform
records and each Xcode's `version.plist`, and passes the real SDK with
`--sdk`. Swift Build then registers the SDK exactly as it does inside Xcode.
The image's flags reach it through a toolchain `Info.plist` scoped to Apple
SDKs, the same hook Xcode's own toolchains use.

**The SwiftUI macros are the one reimplementation.** In recent SDKs, `@State`,
`@Entry`, and `#Preview` are macros whose plugins exist only as closed macOS
binaries. Linux builds of them live in `macros/`. They are held to Apple's
behaviour mechanically. `check-against-xcode.sh` expands every fixture with
Xcode's plugins and with these, and requires identical output. A macro the SDK
declares but the plugin does not provide fails the build by name. It is never
silently skipped.

**`applebuild` replaces only `xcodebuild`'s orchestration.** It reads the same
XcodeGen `project.yml` that Xcode's project is generated from. It resolves
build settings through XcodeGen's and Xcode's layers, and delegates the real
work to the pieces above. What it adds is bundle assembly: framework embedding,
the keys Xcode's Info.plist processing adds, dSYMs, and signing with rcodesign.

## Tradeoffs that remain

Some differences are inherent. Asset catalogs and storyboards need `actool`
and `ibtool`, which are Mac-only and closed. A target with an asset catalog
therefore takes precompiled assets rather than pretending. `BuildMachineOSBuild`
records the Mac that ran a build, and there is none.

Others come from Swift Build's semantics differing from Xcode's. Swift Build
compiles every package in the graph for the app's deployment target. Xcode
compiles each package for its own minimum instead, so an old-minimum
dependency back-deploys fewer runtime shims here. The binaries behave the
same, but they are not byte-identical.

## One image per SDK, published publicly

Each image pairs one macOS SDK with the Swift that shipped in that Xcode.
Swift 6.1 is the exception: it has no Swift Build, so the macOS 15 image uses
6.2. The deployment target is independent of the SDK, so every image still
targets macOS 15 by default.

The images include Apple's SDKs and are published publicly, as the 2023 images
were. That was a deliberate choice, not an oversight. Apple's Xcode license
restricts redistributing the SDKs, and the README tells users so. The SDK
tarballs themselves live in the private `apple-sdks` SeaweedFS bucket, pinned
by sha256. Staging one needs a Mac with that exact Xcode installed, so the
bucket is backed up rather than treated as rebuildable.

The in-cluster BuildKit daemon runs on the amd64 CI node. It builds the arm64
images under QEMU, registered on the node by an init container. That makes
arm64 builds slow, which is why the image lane ignores CI-plumbing changes and
rebuilds only when the toolchain package changes.
