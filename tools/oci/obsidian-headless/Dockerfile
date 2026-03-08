FROM node:22-slim@sha256:9c2c405e3ff9b9afb2873232d24bb06367d649aa3e6259cbe314da59578e81e9
RUN npm install -g obsidian-headless
LABEL org.opencontainers.image.title="obsidian-headless"
LABEL org.opencontainers.image.description="Obsidian Headless CLI for syncing vaults from the command line"
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["ob sync-setup --vault \"$OBSIDIAN_VAULT_NAME\" --password \"$OBSIDIAN_VAULT_PASSWORD\" --path /vault && ob sync --continuous --path /vault"]
