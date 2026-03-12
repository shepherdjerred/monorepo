FROM oven/bun:slim
RUN bun add -g obsidian-headless
LABEL org.opencontainers.image.title="obsidian-headless"
LABEL org.opencontainers.image.description="Obsidian Headless CLI for syncing vaults from the command line"
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["ob sync-setup --vault \"$OBSIDIAN_VAULT_NAME\" --password \"$OBSIDIAN_VAULT_PASSWORD\" --path /vault && ob sync --continuous --path /vault"]
