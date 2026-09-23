# Browser binaries and system dependencies stay pinned together in the official
# Playwright image. Bun is copied from its immutable image so e2e jobs perform
# no runtime downloads.
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun

# renovate: datasource=docker depName=mcr.microsoft.com/playwright
FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN bun --version \
  && bun -e 'const info = await Bun.file("/ms-playwright/.docker-info").json(); if (typeof info.driverVersion !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(info.driverVersion)) throw new Error("invalid Playwright browser inventory")' \
  && test -x /ms-playwright/chromium-*/chrome-linux*/chrome \
  && test -x /ms-playwright/firefox-*/firefox/firefox \
  && test -x /ms-playwright/webkit-*/minibrowser-gtk/MiniBrowser
