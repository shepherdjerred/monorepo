# syntax=docker/dockerfile:1-labs@sha256:63e440b412b6acba117974e793b7e7f702e58ee65e044bdff1b8d388ee0d853b
# Cross-compiles Windows software on Linux. Build context is the REPO ROOT.
#
#   base      clang-cl/lld with the MSVC CRT and Windows SDK (via cargo-xwin),
#             Rust for x86_64/aarch64-pc-windows-msvc, the .NET SDK, and NSIS.
#             No Wine; builds on linux/amd64 and linux/arm64.
#   winui     base plus Wine 11.0 and .NET Framework 4.8 running Microsoft's
#             Windows-only tools (XamlCompiler.exe, makepri, makeappx) for
#             Windows App SDK and MSIX projects. linux/amd64 only.
#   selftest-base / selftest-winui build the samples/ and check the output.
#
# Wine 11.0 is patched where those tools reach unimplemented APIs; see
# wine-patches/. Nothing here signs binaries or packages.

FROM ubuntu:24.04@sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3 AS ubuntu
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV DEBIAN_FRONTEND=noninteractive

# ── wine-dlls: Wine 11.0 DLLs carrying the patches under wine-patches/ ──────
FROM ubuntu AS wine-dlls
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# Unpinned on purpose, as in .buildkite/ci-image: the archive drops superseded
# point releases. The Wine source itself is pinned and checksummed below.
# hadolint ignore=DL3008
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    bison ca-certificates curl flex gcc gcc-mingw-w64-x86-64 libc6-dev make patch xz-utils \
    && rm -rf /var/lib/apt/lists/*
ARG WINE_VERSION=11.0
ARG WINE_SOURCE_SHA256=c07a6857933c1fc60dff5448d79f39c92481c1e9db5aa628db9d0358446e0701
RUN curl -fsSL "https://dl.winehq.org/wine/source/${WINE_VERSION}/wine-${WINE_VERSION}.tar.xz" -o /tmp/wine.tar.xz \
    && echo "${WINE_SOURCE_SHA256}  /tmp/wine.tar.xz" | sha256sum -c - \
    && mkdir /src && tar -xJf /tmp/wine.tar.xz -C /src --strip-components=1 && rm /tmp/wine.tar.xz
WORKDIR /src
COPY packages/windows-cross-compiler/wine-patches/ /wine-patches/
RUN for p in /wine-patches/*.patch; do patch -p1 --fuzz=0 < "$p"; done \
    && ./configure --enable-win64 --without-x --without-freetype --without-gnutls --without-unwind --disable-tests > /tmp/configure.log \
    && make -j"$(nproc)" \
       dlls/msxml3/x86_64-windows/msxml3.dll \
       dlls/ntdll/x86_64-windows/ntdll.dll \
       dlls/shcore/x86_64-windows/shcore.dll > /tmp/make.log \
    && mkdir /out \
    && cp dlls/msxml3/x86_64-windows/msxml3.dll dlls/ntdll/x86_64-windows/ntdll.dll dlls/shcore/x86_64-windows/shcore.dll /out/ \
    && x86_64-w64-mingw32-strip --strip-debug /out/*.dll

# ── base: clang-cl, MSVC CRT + Windows SDK, Rust, .NET SDK, NSIS ────────────
FROM ubuntu AS base
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ARG TARGETARCH
# Microsoft's current STL needs Clang 19 or newer; noble ships LLVM 20 with
# unversioned lld-link and llvm-lib under /usr/lib/llvm-*/bin. gcc links Rust
# build scripts and proc macros for the Linux host.
ARG LLVM_MAJOR=20
# hadolint ignore=DL3008
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    ca-certificates "clang-${LLVM_MAJOR}" curl file gcc libc6-dev libicu74 "lld-${LLVM_MAJOR}" \
    "llvm-${LLVM_MAJOR}" nsis unzip xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Must match global.json.
ARG DOTNET_SDK_VERSION=10.0.303
ARG DOTNET_SDK_SHA512_AMD64=538df11ceb9d86bdda061bab6ede3d1f6d46bb9ba087ae905643f3d456afe982949d1b952bceb305a5d22d2d6e69cc0e5100216ffcc709aaa86e867f2d9cdf9a
ARG DOTNET_SDK_SHA512_ARM64=622e059198058ee5f92d7817bdd83885480a979628348f878201cb8dba52d168c1a324f9943a0e7a03ad547d85332aa82f16aced29da599ef02422b5378452de
ENV DOTNET_ROOT=/opt/dotnet \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    RUSTUP_HOME=/opt/rust/rustup \
    CARGO_HOME=/opt/rust/cargo \
    PATH="/opt/windows-cross/bin:/usr/lib/llvm-${LLVM_MAJOR}/bin:/opt/dotnet:/opt/rust/cargo/bin:${PATH}"
RUN case "${TARGETARCH}" in \
        amd64) rid=linux-x64; sha512="${DOTNET_SDK_SHA512_AMD64}" ;; \
        arm64) rid=linux-arm64; sha512="${DOTNET_SDK_SHA512_ARM64}" ;; \
        *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://builds.dotnet.microsoft.com/dotnet/Sdk/${DOTNET_SDK_VERSION}/dotnet-sdk-${DOTNET_SDK_VERSION}-${rid}.tar.gz" -o /tmp/dotnet.tar.gz \
    && echo "${sha512}  /tmp/dotnet.tar.gz" | sha512sum -c - \
    && mkdir -p "${DOTNET_ROOT}" && tar -xzf /tmp/dotnet.tar.gz -C "${DOTNET_ROOT}" && rm /tmp/dotnet.tar.gz \
    && dotnet --version | grep -Fx "${DOTNET_SDK_VERSION}"

# Must match the rust pin in the repo's .mise.toml.
ARG RUST_VERSION=1.98.1
# renovate: datasource=github-tags depName=rust-lang/rustup
ARG RUSTUP_VERSION=1.29.1
ARG RUSTUP_INIT_SHA256_AMD64=dda7234360b7f578ca8b0ddcb80145646fa61a67c1720a5abc7051b35c9fcb71
ARG RUSTUP_INIT_SHA256_ARM64=15f6e4ce9f583b929c996c91562bad6d4454f3281de858b02cdfdef615fac433
# renovate: datasource=github-releases depName=rust-cross/cargo-xwin
ARG CARGO_XWIN_VERSION=0.23.1
ARG CARGO_XWIN_SHA256_AMD64=c492c6dfb7e5ac0eee586b796e0fc950ba13077e7f0bbb046f445d71790d5360
ARG CARGO_XWIN_SHA256_ARM64=dc0a0fb28fdd90405f69e7365bce91d2504ea7491eb4d79d5655ffa106358925
# cargo-xwin downloads the MSVC CRT and Windows SDK libraries into the image;
# building this image accepts their license.
ENV XWIN_ACCEPT_LICENSE=1 \
    XWIN_CACHE_DIR=/opt/windows-cross/xwin
RUN case "${TARGETARCH}" in \
        amd64) host=x86_64; rustup_sha256="${RUSTUP_INIT_SHA256_AMD64}"; xwin_sha256="${CARGO_XWIN_SHA256_AMD64}" ;; \
        arm64) host=aarch64; rustup_sha256="${RUSTUP_INIT_SHA256_ARM64}"; xwin_sha256="${CARGO_XWIN_SHA256_ARM64}" ;; \
        *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/${host}-unknown-linux-gnu/rustup-init" -o /tmp/rustup-init \
    && echo "${rustup_sha256}  /tmp/rustup-init" | sha256sum -c - \
    && chmod +x /tmp/rustup-init \
    && /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}" \
       --target x86_64-pc-windows-msvc --target aarch64-pc-windows-msvc \
    && rm /tmp/rustup-init \
    && curl -fsSL "https://github.com/rust-cross/cargo-xwin/releases/download/v${CARGO_XWIN_VERSION}/cargo-xwin-v${CARGO_XWIN_VERSION}.${host}-unknown-linux-musl.tar.gz" -o /tmp/cargo-xwin.tar.gz \
    && echo "${xwin_sha256}  /tmp/cargo-xwin.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/cargo-xwin.tar.gz -C "${CARGO_HOME}/bin" && rm /tmp/cargo-xwin.tar.gz \
    && cargo xwin env --target x86_64-pc-windows-msvc > /dev/null \
    && cargo xwin env --target aarch64-pc-windows-msvc > /dev/null \
    && test -d "${XWIN_CACHE_DIR}/xwin/crt/lib/x86_64" && test -d "${XWIN_CACHE_DIR}/xwin/crt/lib/aarch64"

COPY --chmod=755 packages/windows-cross-compiler/bin/windows-cross-cl /opt/windows-cross/bin/windows-cross-cl
# Ubuntu packages clang-cl separately (clang-tools); clang takes its cl.exe
# driver mode from the name it is invoked as.
RUN ln -s "/usr/lib/llvm-${LLVM_MAJOR}/bin/clang" /opt/windows-cross/bin/clang-cl \
    && ln -s windows-cross-cl /opt/windows-cross/bin/x86_64-pc-windows-msvc-cl \
    && ln -s windows-cross-cl /opt/windows-cross/bin/aarch64-pc-windows-msvc-cl \
    && clang-cl --version && command -v lld-link llvm-lib
# Windows-targeted .NET projects restore and compile on Linux.
ENV EnableWindowsTargeting=true
WORKDIR /workspace

# ── winui: Wine + .NET Framework 4.8 for Windows App SDK and MSIX ───────────
FROM base AS winui
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# hadolint ignore=DL3008
RUN test "$(dpkg --print-architecture)" = amd64 \
    && dpkg --add-architecture i386 && apt-get update -qq && apt-get install -y -qq --no-install-recommends \
       cabextract gnupg winbind \
    && rm -rf /var/lib/apt/lists/*

# WineHQ's archive keeps every build, so the exact version the patched DLLs
# come from is pinned.
ARG WINEHQ_ARCHIVE_SIGNER_SHA256=d965d646defe94b3dfba6d5b4406900ac6c81065428bf9d9303ad7a72ee8d1b8
ARG WINEHQ_PACKAGE_VERSION=11.0.0.0~noble-1
# WineHQ installs its packages with their recommendations.
# hadolint ignore=DL3015
RUN install -d -m 755 /etc/apt/keyrings \
    && curl -fsSL https://dl.winehq.org/wine-builds/winehq.key -o /tmp/winehq.key \
    && echo "${WINEHQ_ARCHIVE_SIGNER_SHA256}  /tmp/winehq.key" | sha256sum -c - \
    && gpg --dearmor -o /etc/apt/keyrings/winehq-archive.key /tmp/winehq.key && rm /tmp/winehq.key \
    && printf '%s\n' 'Types: deb' 'URIs: https://dl.winehq.org/wine-builds/ubuntu' 'Suites: noble' \
       'Components: main' 'Architectures: amd64 i386' 'Signed-By: /etc/apt/keyrings/winehq-archive.key' \
       > /etc/apt/sources.list.d/winehq-noble.sources \
    && apt-get update -qq && apt-get install -y -qq --install-recommends \
       "winehq-stable=${WINEHQ_PACKAGE_VERSION}" "wine-stable=${WINEHQ_PACKAGE_VERSION}" \
       "wine-stable-amd64=${WINEHQ_PACKAGE_VERSION}" "wine-stable-i386=${WINEHQ_PACKAGE_VERSION}" \
    && rm -rf /var/lib/apt/lists/* \
    && wine --version | grep -Fx "wine-11.0"

ENV WINEPREFIX=/opt/wineprefix \
    WINEARCH=win64 \
    WINEDEBUG=-all \
    XDG_RUNTIME_DIR=/tmp/xdg
# renovate: datasource=github-tags depName=Winetricks/winetricks
ARG WINETRICKS_VERSION=20260125
ARG WINETRICKS_SHA256=431f82fc74000e6c864409f1d8fb495d696c03928808e3e8acffc45179312a7b
RUN mkdir -m 700 "${XDG_RUNTIME_DIR}" \
    && curl -fsSL "https://raw.githubusercontent.com/Winetricks/winetricks/${WINETRICKS_VERSION}/src/winetricks" -o /usr/local/bin/winetricks \
    && echo "${WINETRICKS_SHA256}  /usr/local/bin/winetricks" | sha256sum -c - \
    && chmod +x /usr/local/bin/winetricks \
    && wineboot --init && wineserver -w \
    && winetricks -q --unattended dotnet48 && wineserver -w \
    && test -f "${WINEPREFIX}/drive_c/windows/Microsoft.NET/Framework64/v4.0.30319/clr.dll"

# Wine loads built-in DLLs from its library directory, not the prefix, so the
# patched ones replace the stock ones here, after the slow layers.
COPY --from=wine-dlls /out/ /opt/wine-stable/lib/wine/x86_64-windows/
COPY --chmod=755 packages/windows-cross-compiler/bin/windows-cross-wine-run /opt/windows-cross/bin/windows-cross-wine-run
COPY packages/windows-cross-compiler/msbuild/WindowsCross.targets /opt/windows-cross/msbuild/WindowsCross.targets
ENV WindowsCrossTargets=/opt/windows-cross/msbuild/WindowsCross.targets

# ── self-tests ───────────────────────────────────────────────────────────────
FROM base AS selftest-base
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
COPY packages/windows-cross-compiler/samples/ /selftest/samples/
COPY --chmod=755 packages/windows-cross-compiler/test/selftest-base.sh /selftest/selftest-base.sh
RUN /selftest/selftest-base.sh /selftest/samples 2>&1 | tee /selftest/base.log

FROM winui AS selftest-winui
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
COPY packages/windows-cross-compiler/samples/ /selftest/samples/
COPY --chmod=755 packages/windows-cross-compiler/test/selftest-winui.sh /selftest/selftest-winui.sh
RUN /selftest/selftest-winui.sh /selftest/samples 2>&1 | tee /selftest/winui.log

# The base self-test log alone, for hosts that cannot build winui (linux/arm64).
FROM scratch AS selftest-base-report
COPY --from=selftest-base /selftest/base.log /

# Both self-test logs, for export as a build artifact.
FROM scratch AS selftest-report
COPY --from=selftest-base /selftest/base.log /
COPY --from=selftest-winui /selftest/winui.log /
