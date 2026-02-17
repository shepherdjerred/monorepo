# Clauderon Example Dockerfiles

This directory contains example Dockerfiles for building Clauderon-compatible images.

## Examples

### `minimal.Dockerfile`

**Purpose**: Demonstrates the absolute bare minimum requirements.

**Includes**:

- `bash` shell
- `curl` for hooks
- Claude Code CLI
- Standard utilities (from base image: `mkdir`, `chmod`, `cat`, `date`)

**Use when**: You want the smallest possible image and will add development tools yourself.

**Build**:

```bash
docker build -f minimal.Dockerfile -t clauderon-minimal .
```

**Note**: This image does NOT include git. You'll need to add it if you want git operations to work inside sessions.

### `recommended.Dockerfile`

**Purpose**: Recommended baseline with git and common development tools.

**Includes**:

- Everything from minimal
- `git` CLI
- `build-essential` (gcc, g++, make)
- Common tools (`wget`, `unzip`)

**Use when**: You want a good starting point with essential development tools.

**Build**:

```bash
docker build -f recommended.Dockerfile -t clauderon-recommended .
```

## Using Custom Images with Clauderon

After building your image, use it with Clauderon:

```bash
# Create a session with custom image
clauderon create \
    --image your-image:tag \
    --name my-session \
    --repository /path/to/repo
```

Or set it as the default in your Clauderon configuration.

## Adding Language-Specific Tools

These examples are intentionally minimal. Add your project's requirements:

### Node.js

```dockerfile
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs
```

### Python

```dockerfile
RUN apt-get update && apt-get install -y python3 python3-pip
```

### Rust

```dockerfile
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Optional: Install sccache for faster builds
RUN cargo install sccache
```

### Go

```dockerfile
RUN wget https://go.dev/dl/go1.21.0.linux-amd64.tar.gz && \
    tar -C /usr/local -xzf go1.21.0.linux-amd64.tar.gz && \
    rm go1.21.0.linux-amd64.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"
```

## Alpine Linux

Alpine users must install bash explicitly:

```dockerfile
FROM alpine:latest

RUN apk add --no-cache bash curl ca-certificates git

# Install Claude Code CLI
RUN curl -fsSL https://install.claude.ai/cli.sh | sh

WORKDIR /workspace
CMD ["/bin/bash"]
```

## Full Reference

For a full-featured production image, see the default Clauderon image:

- Repository: [shepherdjerred/dotfiles](https://github.com/shepherdjerred/dotfiles)
- Image: `ghcr.io/shepherdjerred/dotfiles`

It includes:

- All required dependencies
- Rust toolchain with sccache
- Multiple language runtimes (Node.js, Python, Go)
- Version management (mise)
- Modern shell (Fish)
- Size optimizations

## Requirements Reference

See [`../docs/IMAGE_COMPATIBILITY.md`](../docs/IMAGE_COMPATIBILITY.md) for complete requirements documentation.

**TL;DR** - Your image must have:

1. `claude` or `codex` CLI
2. `bash` shell
3. Writable `/workspace` directory
4. `curl` binary
5. Standard Unix utilities (`mkdir`, `chmod`, `cat`, `date`)
