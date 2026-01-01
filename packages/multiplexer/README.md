# Multiplexer

A Rust-based session multiplexer for managing Claude Code sessions with both CLI/TUI and web interfaces.

## Prerequisites

- **Rust** (1.85+) - Install via [rustup](https://rustup.rs/)
- **Bun** (1.3.5+) - Install via [bun.sh](https://bun.sh/)
- **typeshare-cli** - Install via `cargo install typeshare-cli`

## Build Order

The frontend must be built before the Rust binary because static files are embedded at compile time.

```bash
# 1. Install web dependencies
cd web && bun install && cd ..

# 2. Build frontend (generates dist/ with static files)
cd web/frontend && bun run build && cd ../..

# 3. Build Rust binary (embeds frontend dist/)
cargo build --release
```

Or use the full build command:

```bash
cd web && bun run build && cd .. && cargo build --release
```

## Running the Web Interface

Start the daemon with HTTP server enabled:

```bash
# Start daemon with web interface on port 3030
./target/release/mux daemon --http-port 3030
```

Then open http://localhost:3030 in your browser.

### CLI Options

```bash
mux daemon --help

Options:
  --http-port <PORT>  Enable HTTP server on specified port
  --socket <PATH>     Unix socket path (default: /tmp/mux.sock)
```

## Development

### Web Packages

The web interface is split into three packages in `web/`:

- **@mux/shared** - Shared types (generated from Rust via typeshare)
- **@mux/client** - TypeScript API client library
- **@mux/frontend** - React frontend application

```bash
cd web

# Development
bun run dev           # Start frontend dev server

# Testing
bun run test          # Run all web tests

# Linting
bun run lint          # Lint all web packages

# Building
bun run build         # Build all web packages
```

### Rust Development

```bash
# Run tests
cargo test

# Format code
cargo fmt

# Lint
cargo clippy

# Run daemon in development
cargo run -- daemon --http-port 3030
```

### Regenerating Types

When Rust types change, regenerate TypeScript types:

```bash
typeshare . --lang=typescript --output-file=web/shared/src/generated/index.ts
```

This is automatically run during `cargo build`.

## Architecture

```
multiplexer/
├── src/              # Rust source code
│   ├── api/          # HTTP/WebSocket API
│   ├── core/         # Session management
│   ├── tui/          # Terminal UI
│   └── main.rs       # CLI entry point
├── web/              # TypeScript packages
│   ├── shared/       # Shared types
│   ├── client/       # API client
│   └── frontend/     # React UI
└── build.rs          # Build script (typeshare + embed)
```

## API Endpoints

### REST API

- `GET /api/sessions` - List all sessions
- `GET /api/sessions/:id` - Get session by ID
- `POST /api/sessions` - Create new session
- `DELETE /api/sessions/:id` - Delete session
- `POST /api/sessions/:id/archive` - Archive session
- `POST /api/sessions/:id/access-mode` - Update access mode
- `GET /api/recent-repos` - List recent repositories

### WebSocket Endpoints

- `/ws/console/:session_id` - Terminal console stream
- `/ws/events` - Real-time session events
