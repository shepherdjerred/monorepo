# Browser binaries and system dependencies stay pinned together in the official
# Playwright image. Bun and unzip are added at image build time so e2e jobs do
# not apt-install or curl on every fresh pod.
FROM oven/bun:1.3.14 AS bun

# renovate: datasource=docker depName=mcr.microsoft.com/playwright
FROM mcr.microsoft.com/playwright:v1.61.1-noble

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update \
  && apt-get install --yes --no-install-recommends unzip \
  && rm -rf /var/lib/apt/lists/*

RUN bun --version \
  && unzip -v >/dev/null \
  && bunx --bun --yes playwright@1.61.1 --version
