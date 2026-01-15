# Recommended Clauderon image
# Includes all required dependencies plus git and common development tools

FROM debian:bookworm-slim

# Install required dependencies + git + common tools
RUN apt-get update && apt-get install -y \
    bash \
    ca-certificates \
    curl \
    git \
    build-essential \
    wget \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
# Note: Replace with actual installation method
# This is a placeholder - see https://claude.ai for installation instructions
RUN curl -fsSL https://install.claude.ai/cli.sh | sh

# Set working directory
WORKDIR /workspace

# Default command
CMD ["/bin/bash"]
