# Minimal Clauderon-compatible image
# Contains only the absolute bare minimum requirements

FROM debian:bookworm-slim

# Install only required dependencies
RUN apt-get update && apt-get install -y \
    bash \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
# Note: Replace with actual installation method
# This is a placeholder - see https://claude.ai for installation instructions
RUN curl -fsSL https://install.claude.ai/cli.sh | sh

# Set working directory
WORKDIR /workspace

# Default command
CMD ["/bin/bash"]
