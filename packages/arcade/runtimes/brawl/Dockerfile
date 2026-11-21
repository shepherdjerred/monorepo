# syntax=docker/dockerfile:1-labs@sha256:36366b12c1dffb228bb25e9feffb73707b93388f084f4927d2b7686dba29e76a
FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS dolphin
# Debian removes superseded patch releases; install supported archive packages.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates git g++ cmake ninja-build pkg-config patch \
    libgl-dev libegl-dev libudev-dev libevdev-dev libusb-1.0-0-dev \
    libhidapi-dev libcurl4-openssl-dev liblzma-dev libbz2-dev \
    libzstd-dev liblzo2-dev libpng-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init -q . \
  && git remote add origin https://github.com/dolphin-emu/dolphin.git \
  && git fetch -q --depth=1 origin 2614969fa80dfeb87d2a4ad3bdaa703237127074 \
  && git checkout -q --detach FETCH_HEAD \
  && git submodule update --init --recursive --depth=1 \
    Externals/SDL/SDL Externals/libusb/libusb Externals/spirv_cross/SPIRV-Cross \
    Externals/zlib-ng/zlib-ng Externals/libspng/libspng Externals/implot/implot \
    Externals/curl/curl Externals/fmt/fmt Externals/lz4/lz4 Externals/xxhash/xxHash \
    Externals/enet/enet Externals/hidapi/hidapi-src Externals/tinygltf/tinygltf \
    Externals/minizip-ng/minizip-ng Externals/watcher/watcher Externals/SFML/SFML \
    Externals/zstd/zstd Externals/glslang/glslang Externals/pugixml/pugixml \
    Externals/cpp-optparse/cpp-optparse Externals/imgui/imgui Externals/cpp-ipc/cpp-ipc
COPY packages/arcade/runtimes/brawl/dolphin.patch /bridge/dolphin.patch
RUN git apply --check /bridge/dolphin.patch && git apply /bridge/dolphin.patch
COPY packages/arcade/runtimes/brawl/ArcadeBridge.cpp packages/arcade/runtimes/brawl/ArcadeBridge.h /src/Source/Core/Common/
COPY packages/arcade/runtimes/wire.generated.h /src/Source/Core/Common/ArcadeWire.h
COPY packages/arcade/runtimes/brawl/ArcadeTelemetry.cpp packages/arcade/runtimes/brawl/ArcadeTelemetry.h /src/Source/Core/Core/
RUN cmake -S . -B build -GNinja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=/opt/dolphin -DENABLE_QT=OFF -DENABLE_HEADLESS=ON \
    -DENABLE_X11=OFF -DENABLE_EGL=ON \
    -DENABLE_ALSA=OFF -DENABLE_PULSEAUDIO=OFF -DENABLE_CUBEB=OFF \
    -DENABLE_LLVM=OFF -DENABLE_TESTS=OFF -DENABLE_VULKAN=OFF -DENABLE_CLI_TOOL=OFF \
    -DUSE_DISCORD_PRESENCE=OFF -DUSE_MGBA=OFF -DUSE_RETRO_ACHIEVEMENTS=OFF \
    -DUSE_UPNP=OFF -DENABLE_AUTOUPDATE=OFF -DENABLE_ANALYTICS=OFF \
    -DENCODE_FRAMEDUMPS=OFF \
  && cmake --build build --target dolphin-emu-nogui -j6 \
  && cmake --install build
