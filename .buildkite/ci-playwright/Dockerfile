# Browser binaries and system dependencies stay pinned together in the official
# Playwright image. Bun is copied from its immutable image so e2e jobs perform
# no runtime downloads.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun

# renovate: datasource=docker depName=mcr.microsoft.com/playwright
FROM mcr.microsoft.com/playwright:v1.62.0-noble@sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN bun --version \
  && bun -e 'const info = await Bun.file("/ms-playwright/.docker-info").json(); if (typeof info.driverVersion !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(info.driverVersion)) throw new Error("invalid Playwright browser inventory")' \
  && test -x /ms-playwright/chromium-*/chrome-linux*/chrome \
  && test -x /ms-playwright/firefox-*/firefox/firefox \
  && test -x /ms-playwright/webkit-*/minibrowser-gtk/MiniBrowser
