# Scout for LoL - Desktop Client

Tauri desktop application that monitors your League of Legends games in real
time and forwards game events to the Scout backend, which plays sounds in
Discord voice channels and drives live-game features. The desktop app never
talks to Discord directly — it authenticates to the backend with an API token.

## Technology Stack

- **Backend**: Rust (Tauri)
- **Frontend**: React + TypeScript + Vite + Tailwind
- **LCU Integration**: League Client (LCU) API and the Live Client Data API (port 2999)
- **Delivery**: HTTP calls to the Scout backend (`backend_client.rs`)

## Architecture

### Rust core (`src-tauri/src/`)

| Module              | Responsibility                                                                       |
| ------------------- | ------------------------------------------------------------------------------------ |
| `main.rs`           | Application entry point and Tauri command handlers                                   |
| `lcu.rs`            | League Client process detection and LCU API connection (port + auth token discovery) |
| `live_client.rs`    | Live Client Data API client (`https://127.0.0.1:2999`, only available in-game)       |
| `events.rs`         | Polls live game data / listens to the LCU WebSocket and forwards events              |
| `backend_client.rs` | Authenticated HTTP client for the Scout backend (event delivery, status checks)      |
| `config.rs`         | Persists settings to `config.json`: generated client ID, API token, backend URL      |
| `paths.rs`          | Centralized app-data layout: config, logs, cached sounds                             |
| `tests.rs`          | Rust unit tests                                                                      |

### React frontend (`src/`)

- `app.tsx`: Application UI and connection state machine
- `components/`: `layout/`, `sections/` (setup and status panels), `ui/` (shared primitives from `@scout-for-lol/ui`)
- `lib/`: utilities
- `main.tsx`, `styles.css`: entry point and styles

## Setup Flow

1. **Connect to League Client** — the app scans running processes for
   `LeagueClientUx`, extracts the LCU port and auth token from its arguments,
   and connects (the LCU uses a self-signed certificate and
   `riot:<token>` basic auth).
2. **Configure the backend** — enter the Scout backend URL and an API token;
   the app stores them (plus a generated per-install client ID) in
   `config.json` under the app data directory.
3. **Test the connection** — verifies the token against the backend.
4. **Start monitoring** — game events (kills, objectives, game start/end) are
   read from the Live Client Data API and forwarded to the backend.

## Development

Prerequisites: Rust (stable), Bun, and League of Legends for end-to-end testing.

```bash
bun install          # from the repo root (single workspace install)
cd packages/scout-for-lol/packages/desktop   # the scripts below are this package's

bun run dev          # Tauri dev mode (Rust + Vite frontend)
bun run dev:frontend # Vite dev server only
bun run typecheck    # tsc --noEmit
bun run lint         # ESLint
bun run format       # Prettier check
```

### Building

```bash
bun run build            # Frontend bundle only (vite build)
bun run build:tauri      # Platform installer for the current host
bun run build:macos      # macOS universal binary
bun run build:macos:arm  # macOS arm64
bun run build:windows    # Windows x86_64 (GNU toolchain)
bun run build:linux      # Linux
```

Installers land in `src-tauri/target/release/bundle/`.

## Troubleshooting

- **Can't connect to League Client**: make sure League is running; restart the client.
- **Backend not reachable**: verify the backend URL and API token in the app; check the debug logs (paths listed in `paths.rs`).
- **Build errors**: `rustup update`, then `cargo clean`.

## License

GPL-3.0-only

## Links

- [Main Repository](https://github.com/shepherdjerred/monorepo/tree/main/packages/scout-for-lol)
- [Tauri Documentation](https://tauri.app/)
- [LCU API Documentation](https://hextechdocs.dev/)
