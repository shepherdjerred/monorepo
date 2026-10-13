# syntax=docker/dockerfile:1-labs@sha256:ad43eec41369d9ef94412c0d1eb3203d12218d01da225afc92a3aeba3a0e7796
# Browser binaries and system dependencies stay pinned together in the official
# Playwright image. Bun is copied from its immutable image so e2e jobs perform
# no runtime downloads.
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun

# renovate: datasource=docker depName=mcr.microsoft.com/playwright
FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# hadolint ignore=DL3008
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    ca-certificates curl git minisign unzip xz-utils util-linux libxml2 \
    && rm -rf /var/lib/apt/lists/*

# Same signed mise bootstrap as ci-base. Only the postgres scope is installed:
# browser jobs do not need Rust, Java, .NET or their download caches.
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
    && rm "${mise_asset}" SHASUMS256.txt SHASUMS256.txt.minisig

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY .mise.toml mise.lock /workspace/
WORKDIR /workspace
RUN --mount=type=secret,id=github-download-token,env=GH_TOKEN,required=true \
    mise trust .mise.toml \
    && GITHUB_TOKEN="${GH_TOKEN}" mise install --locked bun node 'github:theseus-rs/postgresql-binaries' 'aqua:temporalio/cli' \
    && mise reshim \
    && chmod -R a+rX /opt/mise \
    && mise exec bun -- bun --version \
    && mise exec node -- node --version \
    && mise exec 'github:theseus-rs/postgresql-binaries' -- postgres --version \
    && mise exec 'aqua:temporalio/cli' -- temporal --version
RUN bun --version \
  && bun -e 'const info = await Bun.file("/ms-playwright/.docker-info").json(); if (typeof info.driverVersion !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(info.driverVersion)) throw new Error("invalid Playwright browser inventory")' \
  && test -x /ms-playwright/chromium-*/chrome-linux*/chrome \
  && test -x /ms-playwright/firefox-*/firefox/firefox \
  && test -x /ms-playwright/webkit-*/minibrowser-gtk/MiniBrowser
