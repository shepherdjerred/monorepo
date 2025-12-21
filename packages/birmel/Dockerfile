# syntax=docker/dockerfile:1

# ============================================================================
# BUILD STAGE
# ============================================================================
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files for dependency installation
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# ============================================================================
# PRODUCTION STAGE
# ============================================================================
FROM oven/bun:1-slim AS production

# Install ffmpeg for audio processing (voice/music features)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 birmel && \
    adduser --system --uid 1001 --ingroup birmel birmel

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy source code
COPY --chown=birmel:birmel package.json ./
COPY --chown=birmel:birmel tsconfig.json ./
COPY --chown=birmel:birmel src ./src

# Create data directory for SQLite database
RUN mkdir -p /app/data && chown birmel:birmel /app/data

# Switch to non-root user
USER birmel

# Set environment variables
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/birmel.db

# Expose no ports (Discord bot uses websocket connections, not inbound ports)

# Health check - verify the process is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD pgrep -f "bun run src/index.ts" || exit 1

# Run the bot
CMD ["bun", "run", "src/index.ts"]
