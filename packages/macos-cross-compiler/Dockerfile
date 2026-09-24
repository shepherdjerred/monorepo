# macos-cross-compiler: build macOS, iOS, and Mac Catalyst software on Linux.
#
# One image per macOS SDK (see sdks.json). The build context is this package
# directory, which must hold .stage/<SDK>/ from scripts/stage-xcode.sh — CI
# downloads it from the private apple-sdks bucket by the sha256 in sdks.json.
#
#   docker build --build-arg SDK=27 --build-arg SWIFT_IMAGE=swift:6.4.0-noble .
#
# Stages: `cctools` (Apple's ld64 + libtapi, the slow part, cached across
# tags), `image` (the published toolchain), `smoke` (builds every sample).
ARG SWIFT_IMAGE=swift:6.4.0-noble
ARG LLVM_VERSION=22

# ── Apple's open-source ld64 and cctools, with Apple's libtapi so ld64 reads
# the SDK's .tbd stubs. Built from the same Swift image as the final stage: it
# links that image's libdispatch and BlocksRuntime.
FROM ${SWIFT_IMAGE} AS cctools
ARG LLVM_VERSION
# apple-libtapi (Apple's .tbd stub library) and cctools-port, pinned by commit.
ARG TBD_LIBRARY_COMMIT=fa9443738c1a18accef4244732ec6d6ee97a8133
ARG CCTOOLS_COMMIT=904de2a71d4da6a9b30d2efaf912a10ddc7d9ddb
RUN apt-get update \
 && apt-get install -y --no-install-recommends git cmake ninja-build python3 autoconf automake make uuid-dev libssl-dev curl gnupg ca-certificates \
 && curl -sSf https://apt.llvm.org/llvm-snapshot.gpg.key | gpg --dearmor -o /usr/share/keyrings/llvm.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/llvm.gpg] https://apt.llvm.org/noble/ llvm-toolchain-noble-$LLVM_VERSION main" > /etc/apt/sources.list.d/llvm.list \
 && apt-get update && apt-get install -y --no-install-recommends "llvm-$LLVM_VERSION-dev"
RUN git clone https://github.com/tpoechtrager/apple-libtapi.git /tmp/apple-libtapi \
 && cd /tmp/apple-libtapi && git checkout "$TBD_LIBRARY_COMMIT" \
 && INSTALLPREFIX=/opt/cctools CC=clang CXX=clang++ JOBS="$(nproc)" ./build.sh && ./install.sh
RUN mkdir -p /tmp/include/block && ln -s /usr/lib/swift/Block/Block.h /tmp/include/block/Block.h \
 && git clone https://github.com/tpoechtrager/cctools-port.git /tmp/cctools-port \
 && cd /tmp/cctools-port/cctools && git checkout "$CCTOOLS_COMMIT" \
 && ./configure --prefix=/opt/cctools --target=arm64-apple-darwin CC=clang CXX=clang++ \
      --with-llvm-config="/usr/bin/llvm-config-$LLVM_VERSION" --with-libtapi=/opt/cctools \
      CFLAGS="-I/usr/lib/swift -I/tmp/include" CXXFLAGS="-I/usr/lib/swift -I/tmp/include" \
      LDFLAGS="-L/usr/lib/swift/linux -Wl,-rpath,/usr/lib/swift/linux -Wl,-rpath,/opt/cctools/lib" \
 && make -j"$(nproc)" && make install

# ── The toolchain.
FROM ${SWIFT_IMAGE} AS image
ARG LLVM_VERSION
ARG SDK=27
ARG RUST_VERSION=1.98.1
# Not RCODESIGN_*: rcodesign reads every RCODESIGN_ variable as configuration.
ARG APPLE_CODESIGN_VERSION=0.29.0

# LLVM matching rustc's (1.98.1 → LLVM 22.1): the Rust static archive carries
# bitcode that older LLVM tools (lipo, ar, LTO) cannot read.
RUN apt-get update \
 && apt-get install -y --no-install-recommends file jq curl ca-certificates xz-utils zip gnupg \
 && curl -sSf https://apt.llvm.org/llvm-snapshot.gpg.key | gpg --dearmor -o /usr/share/keyrings/llvm.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/llvm.gpg] https://apt.llvm.org/noble/ llvm-toolchain-noble-$LLVM_VERSION main" > /etc/apt/sources.list.d/llvm.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends "llvm-$LLVM_VERSION" \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s "/usr/lib/llvm-$LLVM_VERSION" /usr/lib/llvm-apple \
 # Build scripts call these by their Apple names.
 && ln -s /usr/lib/llvm-apple/bin/llvm-lipo /usr/local/bin/lipo \
 && ln -s /usr/lib/llvm-apple/bin/llvm-install-name-tool /usr/local/bin/install_name_tool \
 && ln -s /usr/lib/llvm-apple/bin/llvm-otool /usr/local/bin/otool \
 && ln -s /usr/lib/llvm-apple/bin/dsymutil /usr/local/bin/dsymutil \
 # Host C compiler for cargo build scripts and proc-macros.
 && ln -s /usr/bin/clang /usr/local/bin/cc && ln -s /usr/bin/clang++ /usr/local/bin/c++ \
 # Off an Apple host clang assumes an ancient ld64 and passes `-macosx_version_min`
 # instead of `-platform_version`; 956 is the ld64 this image ships. A driver
 # config file reaches every clang invocation, including the links Swift Build
 # issues itself; it is inert for Linux targets.
 && echo "-mlinker-version=956" | tee /usr/bin/clang.cfg > /usr/bin/clang++.cfg

# Apple's ld64 is the one Darwin linker: it reads the SDK's .tbd stubs through
# libtapi, links Mac Catalyst (whose re-exported macOS-only libraries LLVM's
# ld64.lld rejects), and implements the relocatable `ld -r` links Swift Build
# uses to merge package targets. Its LTO support uses LLVM 22's libLTO, which
# reads the bitcode rustc emits.
COPY --from=cctools /opt/cctools /opt/cctools
RUN ln -s /opt/cctools/bin/arm64-apple-darwin-ld /usr/local/bin/ld64 \
 # Apple's libtool, under its own name: Swift Build parses its version banner.
 && ln -s /opt/cctools/bin/arm64-apple-darwin-libtool /usr/local/bin/libtool

ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain "$RUST_VERSION" \
 && rustup target add aarch64-apple-darwin x86_64-apple-darwin aarch64-apple-ios aarch64-apple-ios-macabi x86_64-apple-ios-macabi

RUN arch=$(uname -m) \
 && curl -sSfL "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F${APPLE_CODESIGN_VERSION}/apple-codesign-${APPLE_CODESIGN_VERSION}-${arch}-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin --strip-components=1 --wildcards '*/rcodesign'

# Linux builds of the SwiftUI macros Xcode ships only as macOS binaries.
COPY macros /opt/apple/macros
RUN cd /opt/apple/macros \
 && swift build -c release --product AppleMacros \
 && install -D .build/release/AppleMacros /opt/apple/plugins/AppleMacros \
 && rm -rf .build

# The xcodebuild stand-in: builds an XcodeGen application target.
COPY applebuild /opt/apple/applebuild
RUN cd /opt/apple/applebuild \
 && swift build -c release --product applebuild \
 && install -D .build/release/applebuild /usr/local/bin/applebuild \
 && rm -rf .build

# The Apple SDK material for this image's SDK version, wired into the
# toolchain the way an Xcode developer directory is (see setup-toolchain.sh).
COPY .stage/${SDK}/sdks /opt/apple/sdks
COPY .stage/${SDK}/swift-resource /opt/apple/swift-resource
COPY .stage/${SDK}/clang-darwin /opt/apple/clang-darwin
COPY .stage/${SDK}/platforms /opt/apple/platforms
COPY .stage/${SDK}/version.plist /opt/apple/version.plist
COPY scripts/setup-toolchain.sh /opt/apple/setup-toolchain.sh
RUN /opt/apple/setup-toolchain.sh
ENV DEVELOPER_DIR=/opt/apple/Developer \
    MACOS_SDK=/opt/apple/sdks/MacOSX.sdk \
    IOS_SDK=/opt/apple/sdks/iPhoneOS.sdk

# clang, clang++, and swiftc per Apple target, under friendly and Rust-target names.
COPY scripts/apple-target.sh /usr/local/lib/apple-target.sh
COPY scripts/apple-clang scripts/apple-swiftc /usr/local/bin/
RUN for t in arm64-apple-macos x86_64-apple-macos arm64-apple-ios arm64-apple-ios-macabi x86_64-apple-ios-macabi; do \
      ln -s apple-clang "/usr/local/bin/$t-clang"; ln -s apple-clang "/usr/local/bin/$t-clang++"; \
      ln -s apple-swiftc "/usr/local/bin/$t-swiftc"; \
    done \
 && for t in aarch64-apple-darwin x86_64-apple-darwin aarch64-apple-ios aarch64-apple-ios-macabi; do \
      ln -s apple-clang "/usr/local/bin/$t-clang"; ln -s apple-clang "/usr/local/bin/$t-clang++"; \
    done
ENV \
    CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER=aarch64-apple-darwin-clang CC_aarch64_apple_darwin=aarch64-apple-darwin-clang CXX_aarch64_apple_darwin=aarch64-apple-darwin-clang++ AR_aarch64_apple_darwin=/usr/lib/llvm-apple/bin/llvm-ar \
    CARGO_TARGET_X86_64_APPLE_DARWIN_LINKER=x86_64-apple-darwin-clang CC_x86_64_apple_darwin=x86_64-apple-darwin-clang CXX_x86_64_apple_darwin=x86_64-apple-darwin-clang++ AR_x86_64_apple_darwin=/usr/lib/llvm-apple/bin/llvm-ar \
    CARGO_TARGET_AARCH64_APPLE_IOS_LINKER=aarch64-apple-ios-clang CC_aarch64_apple_ios=aarch64-apple-ios-clang CXX_aarch64_apple_ios=aarch64-apple-ios-clang++ AR_aarch64_apple_ios=/usr/lib/llvm-apple/bin/llvm-ar \
    CARGO_TARGET_AARCH64_APPLE_IOS_MACABI_LINKER=aarch64-apple-ios-macabi-clang CC_aarch64_apple_ios_macabi=aarch64-apple-ios-macabi-clang CXX_aarch64_apple_ios_macabi=aarch64-apple-ios-macabi-clang++ AR_aarch64_apple_ios_macabi=/usr/lib/llvm-apple/bin/llvm-ar \
    CARGO_TARGET_X86_64_APPLE_IOS_MACABI_LINKER=x86_64-apple-ios-macabi-clang CC_x86_64_apple_ios_macabi=x86_64-apple-ios-macabi-clang CXX_x86_64_apple_ios_macabi=x86_64-apple-ios-macabi-clang++ AR_x86_64_apple_ios_macabi=/usr/lib/llvm-apple/bin/llvm-ar

WORKDIR /workspace
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo" \
      org.opencontainers.image.description="Build macOS, iOS, and Mac Catalyst software on Linux: Swift, SwiftUI, C, C++, Objective-C, and Rust." \
      org.opencontainers.image.title="macos-cross-compiler"
ARG VERSION=dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.version="$VERSION" org.opencontainers.image.revision="$GIT_SHA"

# ── Every promise, exercised: applebuild's unit tests, then each sample built
# for each platform with the resulting Mach-O files checked.
FROM image AS smoke
RUN cd /opt/apple/applebuild && swift test && rm -rf .build
COPY samples /samples
RUN /samples/smoke.sh
