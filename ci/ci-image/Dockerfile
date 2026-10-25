# syntax=docker/dockerfile:1-labs@sha256:ad43eec41369d9ef94412c0d1eb3203d12218d01da225afc92a3aeba3a0e7796
# CI toolchain image — baked from the repo's .mise.toml so agents run the
# EXACT tool versions developers run. Rebuilt every main build via registry
# cache (near-free when unchanged); the toolchain layers invalidate on
# .mise.toml changes.

ARG SWIFTLINT_BUILDER_IMAGE=docker.io/library/swift:6.3.2-jammy@sha256:5f846f008aa76859377d4e9dafe2826c74dde99421bbc60ae2b98d0f1daf72cf

# Build against Jammy's older libc. The upstream 0.65.1 Linux executable
# requires GLIBC_2.38 and cannot execute on our Bookworm image (GLIBC_2.36).
# The compiler stays in this stage; only its declared runtime libraries leave it.
FROM ${SWIFTLINT_BUILDER_IMAGE} AS swiftlint-builder
ARG SWIFTLINT_BUILDER_IMAGE
WORKDIR /swiftlint-source
COPY ci/scripts/swiftlint/pins.json /swiftlint-input/pins.json
COPY ci/scripts/swiftlint/extract-source.py /swiftlint-input/extract-source.py
RUN python3 - <<'PY'
import hashlib
import json
import os
import pathlib
import subprocess
import urllib.request

pins = json.loads(pathlib.Path('/swiftlint-input/pins.json').read_text())
if pins['builderImage'] != os.environ['SWIFTLINT_BUILDER_IMAGE']:
    raise SystemExit('SwiftLint builder does not match its reviewed pin')
archive = pathlib.Path('/swiftlint-source.tar.gz')
with urllib.request.urlopen(pins['sourceArchive'], timeout=60) as response:
    archive.write_bytes(response.read())
if hashlib.sha256(archive.read_bytes()).hexdigest() != pins['sourceArchiveSHA256']:
    raise SystemExit('SwiftLint source archive checksum mismatch')
subprocess.run(['python3', '/swiftlint-input/extract-source.py', str(archive), '/swiftlint-source'], check=True)
archive.unlink()
licenses = pathlib.Path('/swiftlint-input/licenses')
licenses.mkdir()
for license in pins['runtimeLicenses']:
    with urllib.request.urlopen(license['url'], timeout=60) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != license['sha256']:
        raise SystemExit('Swift toolchain license checksum mismatch')
    (licenses / license['name']).write_bytes(data)
PY
RUN python3 - <<'PY'
import os
import resource
import subprocess

os.sched_setaffinity(0, set(sorted(os.sched_getaffinity(0))[:2]))
resource.setrlimit(resource.RLIMIT_AS, (8 * 1024**3, 8 * 1024**3))
subprocess.run(['swift', 'build', '--configuration', 'release', '--product', 'swiftlint', '--jobs', '2', '--disable-automatic-resolution'], check=True)
PY
COPY ci/scripts/swiftlint/runtime-libraries.txt /swiftlint-input/runtime-libraries.txt
RUN set -eu; \
    mkdir -p /swiftlint-output/opt/swiftlint/bin /swiftlint-output/opt/swiftlint/lib /swiftlint-output/opt/swiftlint/licenses; \
    cp .build/release/swiftlint /swiftlint-output/opt/swiftlint/bin/swiftlint; \
    cp LICENSE /swiftlint-output/opt/swiftlint/licenses/SwiftLint-LICENSE; \
    cp /swiftlint-input/licenses/* /swiftlint-output/opt/swiftlint/licenses/; \
    while IFS= read -r runtime_library; do \
      cp -L "$runtime_library" /swiftlint-output/opt/swiftlint/lib/; \
    done < /swiftlint-input/runtime-libraries.txt
RUN python3 - <<'PY'
import pathlib
import shutil

target = pathlib.Path('/swiftlint-output/opt/swiftlint/licenses')
for root, namespace in [(pathlib.Path('/swiftlint-source/.build/checkouts'), 'swift-packages'), (pathlib.Path('/usr/share/doc'), 'builder-runtime')]:
    for source in sorted(root.rglob('*')):
        if source.is_file() and (source.name.lower().startswith(('license', 'notice', 'copying')) or source.name == 'copyright'):
            destination = target / namespace / source.relative_to(root)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
if not (target / 'swift-packages').is_dir():
    raise SystemExit('SwiftLint dependency license inventory is missing')
PY

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS swiftlint-runtime
# hadolint ignore=DL3008
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    ca-certificates libcurl4 libxml2 libstdc++6 libgcc-s1 libatomic1 \
    zlib1g libtinfo6 libedit2 libsqlite3-0 libz3-4 python3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=swiftlint-builder /swiftlint-output/ /
COPY ci/scripts/swiftlint/runtime.sh /opt/swiftlint/swiftlint
COPY ci/scripts/swiftlint/pins.json ci/scripts/swiftlint/verify-capabilities.sh /opt/swiftlint/contract/
COPY packages/tasknotes-macos/.swiftlint.yml packages/tasknotes-macos/.swiftlint-appkit-baseline.json /opt/swiftlint/contract/
RUN chmod 755 /opt/swiftlint/swiftlint \
    && ln -s /opt/swiftlint/swiftlint /usr/local/bin/swiftlint \
    && version="$(python3 -c 'import json; print(json.load(open("/opt/swiftlint/contract/pins.json"))["version"])')" \
    && bash /opt/swiftlint/contract/verify-capabilities.sh /usr/local/bin/swiftlint /opt/swiftlint/contract/.swiftlint.yml "$version"
RUN python3 - <<'PY'
import hashlib
import json
import pathlib
import subprocess

root = pathlib.Path('/opt/swiftlint')
files = sorted(path for path in root.rglob('*') if path.is_file())
manifest = {str(path.relative_to('/')): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
pathlib.Path('/runtime.manifest.json').write_text(json.dumps(manifest, sort_keys=True, indent=2) + '\n')
subprocess.run(['tar', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', '/runtime.tar.gz', '-C', '/', 'opt/swiftlint'], check=True)
digest = hashlib.sha256(pathlib.Path('/runtime.tar.gz').read_bytes()).hexdigest()
pathlib.Path('/runtime.tar.gz.sha256').write_text(digest + '  runtime.tar.gz\n')
PY

FROM scratch AS swiftlint-export
COPY --from=swiftlint-runtime /runtime.tar.gz /runtime.tar.gz.sha256 /runtime.manifest.json /

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS base

# Fail-fast shell for every RUN: a failing producer in a pipeline (curl | sh,
# printf | sha256sum) must fail the build, not be masked by the consumer.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Reproducibility would need a snapshot archive, not
# a version pin. Acknowledged per-site so a NEW unpinned install still fails.
# hadolint ignore=DL3008
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    ca-certificates curl git minisign unzip xz-utils zstd python3 ripgrep rsync \
    build-essential pkg-config libssl-dev libxml2 libcurl4 libatomic1 \
    libtinfo6 libedit2 libsqlite3-0 libz3-4 util-linux ffmpeg \
    && flock --version \
    && ffmpeg -version && ffprobe -version \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI + buildx for image-build steps (BuildKit runs in-pod)
COPY --from=docker:29-cli@sha256:1a4c7cb63513f349bdad01fcc6e0f3f2f67d37b9da86f14dc0d4a0942eecda00 /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker/buildx-bin:0.38.0@sha256:abcf2315937f37bdb52615d1698a4696e3952e88c440a07e7552cbefbc72b1b6 /buildx /usr/local/lib/docker/cli-plugins/docker-buildx

# Full configured SwiftLint, without retaining the compiler toolchain.
COPY --from=swiftlint-runtime /opt/swiftlint /opt/swiftlint
RUN ln -s /opt/swiftlint/swiftlint /usr/local/bin/swiftlint

# mise, pinned to the portable musl release assets; tools come from the
# repo's .mise.toml. Verify the release's signed checksum manifest so Renovate
# only needs to update the version and cannot leave architecture checksums stale.
# renovate: datasource=github-releases depName=jdx/mise
ARG MISE_VERSION=v2026.10.6
ARG MISE_MINISIGN_PUBLIC_KEY=RWTC3g8W3z4RZK3V3qv7fa1QY4JEWyBtqIHW+85QlJpZc5yG+uNYNBSZ
ARG TARGETARCH
ENV MISE_DATA_DIR=/opt/mise \
    PATH="/opt/mise/shims:/root/.local/bin:${PATH}"
RUN case "${TARGETARCH}" in \
        amd64) mise_arch=x64 ;; \
        arm64) mise_arch=arm64 ;; \
        *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && mise_asset="mise-${MISE_VERSION}-linux-${mise_arch}-musl.tar.xz" \
    && curl -fsSL "https://github.com/jdx/mise/releases/download/${MISE_VERSION}/${mise_asset}" -o "/tmp/${mise_asset}" \
    && curl -fsSL "https://github.com/jdx/mise/releases/download/${MISE_VERSION}/SHASUMS256.txt" -o /tmp/SHASUMS256.txt \
    && curl -fsSL "https://github.com/jdx/mise/releases/download/${MISE_VERSION}/SHASUMS256.txt.minisig" -o /tmp/SHASUMS256.txt.minisig \
    && minisign -V -P "${MISE_MINISIGN_PUBLIC_KEY}" -m /tmp/SHASUMS256.txt -x /tmp/SHASUMS256.txt.minisig \
    && cd /tmp \
    && checksum_line="$(grep -F "  ./${mise_asset}" SHASUMS256.txt)" \
    && printf '%s\n' "${checksum_line}" | sha256sum -c - \
    && tar -xJf "${mise_asset}" -C /usr/local/bin --strip-components=2 mise/bin/mise \
    && rm "${mise_asset}" SHASUMS256.txt SHASUMS256.txt.minisig \
    && mise --version

COPY .mise.toml mise.lock /workspace/
WORKDIR /workspace
# mise installs the URLs and checksums mise.lock records; --locked fails rather
# than resolving a tool the lockfile does not cover. The download credential
# is available only to this build step and is never stored in an image layer.
RUN --mount=type=secret,id=github-download-token,env=GITHUB_TOKEN,required=true \
    mise trust .mise.toml && mise install --locked && mise reshim \
    && ln -sf "$(mise which gh)" /usr/local/bin/gh \
    && gh --version

# Android build tools and NDK are published for Linux x86_64. Keep the ARM64
# base image usable for every other workspace; Android actions fail explicitly
# when invoked on that unsupported host architecture.
COPY ci/scripts/android-sdk.sh /workspace/ci/scripts/android-sdk.sh
ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk
RUN if [ "${TARGETARCH}" = amd64 ]; then bash ci/scripts/android-sdk.sh; \
    else echo "Android NDK provisioning omitted: Linux ARM64 host tools are unsupported"; fi

# uv/uvx for the python checks (ruff via uvx, pyright bootstraps a venv)
# renovate: datasource=pypi depName=uv
ARG UV_VERSION=0.13.0
RUN curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | sh

# The bun download cache is NOT baked into this image anymore. The old
# bun-cache-warm stage added ~1 GiB compressed that re-pushed/re-pulled on
# every lockfile change; CI pods now share a persistent node-local cache
# volume instead (woodpecker-bun-cache PVC, mounted by the generated
# pipeline's Kubernetes backend options). The pipeline points
# BUN_INSTALL_CACHE_DIR at the
# mount's data subdirectory. Every install holds a shared lock while the
# threshold-based collector takes the exclusive lock before clearing the
# cache. The shared cache stays warm across builds without living in the image;
# if it's absent, Bun degrades gracefully to network fetches.

CMD ["bash"]
