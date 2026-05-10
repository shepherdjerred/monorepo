FROM node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e
# renovate: datasource=npm depName=obsidian-headless
ARG OBSIDIAN_HEADLESS_VERSION=0.0.8
RUN npm install -g "obsidian-headless@${OBSIDIAN_HEADLESS_VERSION}"
LABEL org.opencontainers.image.title="obsidian-headless"
LABEL org.opencontainers.image.description="Obsidian Headless CLI for syncing vaults from the command line"
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["ob sync-setup --vault \"$OBSIDIAN_VAULT_NAME\" --password \"$OBSIDIAN_VAULT_PASSWORD\" --path /vault && ob sync --continuous --path /vault"]
