# Browser binaries and system dependencies stay pinned together in the official
# Playwright image. Bun and unzip are added at image build time so e2e jobs do
# not apt-install or curl on every fresh pod.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun

# renovate: datasource=docker depName=mcr.microsoft.com/playwright
FROM mcr.microsoft.com/playwright:v1.62.0-noble@sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN rm -f /etc/apt/sources.list.d/nodesource.list /etc/apt/sources.list.d/nodesource.sources \
  && apt-get update \
  && apt-get install --yes --no-install-recommends unzip \
  && rm -rf /var/lib/apt/lists/*

RUN bun --version \
  && unzip -v >/dev/null \
  && bun x --bun --yes playwright@1.62.0 --version
