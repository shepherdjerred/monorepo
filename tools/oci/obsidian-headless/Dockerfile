FROM node:22-slim@sha256:d415caac2f1f77b98caaf9415c5f807e14bc8d7bdea62561ea2fef4fbd08a73c
RUN npm install -g obsidian-headless
LABEL org.opencontainers.image.title="obsidian-headless"
LABEL org.opencontainers.image.description="Obsidian Headless CLI for syncing vaults from the command line"
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["ob sync-setup --vault \"$OBSIDIAN_VAULT_NAME\" --password \"$OBSIDIAN_VAULT_PASSWORD\" --path /vault && ob sync --continuous --path /vault"]
