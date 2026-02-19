# Use Bun official image as base
# renovate: datasource=docker registryUrl=https://docker.io versioning=docker
FROM oven/bun:1.3.9 AS base
WORKDIR /app

# Install dependencies into temp directory
# This will cache dependencies unless they change
FROM base AS install

RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile

# Copy production dependencies and source code
FROM base AS release

# Build arguments for version information
ARG VERSION=dev
ARG GIT_SHA=unknown

COPY --from=install /temp/prod/node_modules node_modules
COPY . .

# Set build-time environment variables
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}

# Runtime required environment variables (must be provided when running container):
# - DISCORD_TOKEN: Discord bot token
# - APPLICATION_ID: Discord application ID
# - DATA_DIR: Data directory path
# - ENVIRONMENT: Environment (dev/beta/prod)
# Optional environment variables:
# - SENTRY_DSN: Sentry DSN for error tracking
# - PORT: Server port (default: 8000)

LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# Create data directory
RUN mkdir -p /app/data

# Expose the port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun run src/health.ts || exit 1

# Run the application
USER bun
CMD ["bun", "run", "src/index.ts"]
