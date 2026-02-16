# Scout for LoL - Desktop Client

Desktop application for real-time League of Legends game updates posted to Discord.

## Overview

This is a Tauri-based desktop application that monitors your League of Legends games in real-time and posts updates to a Discord channel. It connects to the League Client (LCU) API running on your local machine and listens for game events.

## Features

- **Auto-detect League Client**: Automatically finds and connects to the running League of Legends client
- **Discord Integration**: Posts game events directly to Discord using a bot token
- **Real-time Events**: Monitors and posts:
  - Champion select
  - Game start/end
  - Kills, deaths, assists
  - Multi-kills (double, triple, quadra, penta)
  - Objectives (dragons, baron, towers, inhibitors)
- **User-friendly GUI**: Easy setup and configuration for non-technical users
- **Debug Mode**: View logs and connection status
- **Auto-updates**: Built-in update mechanism (configured separately)

## Technology Stack

- **Backend**: Rust (Tauri)
- **Frontend**: React + TypeScript + Vite
- **LCU Integration**: Direct WebSocket connection to League Client API
- **Discord**: Direct API integration using bot tokens

## Architecture

### Rust Backend (`src-tauri/`)

- `main.rs`: Application entry point and Tauri command handlers
- `lcu.rs`: League Client connection and process detection
- `discord.rs`: Discord API client for posting messages
- `events.rs`: WebSocket listener for live game events

### React Frontend (`src/`)

- `App.tsx`: Main application UI
- `main.tsx`: React entry point
- `styles.css`: Application styles

## Setup

### Prerequisites

- Rust (latest stable)
- Bun (for TypeScript/frontend)
- League of Legends installed
- Discord bot token and channel ID

### Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Build for production
bun run build

# Type check
bun run typecheck

# Lint
bun run lint
```

### Building Installers

```bash
bun run build
```

This will create platform-specific installers in `src-tauri/target/release/bundle/`:

- Windows: `.msi` and `.exe` installers
- macOS: `.dmg` and `.app` bundle
- Linux: Can be built on Linux with `AppImage`, `deb`, `rpm`

## Usage

1. **Start the application**
2. **Connect to League Client**: Click "Connect to League Client" (League must be running)
3. **Configure Discord**:
   - Enter your Discord bot token
   - Enter the channel ID where you want updates posted
   - Click "Configure Discord"
4. **Start Monitoring**: Click "Start Monitoring" to begin watching for game events

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token (you'll need this for the desktop app)
5. Enable these intents:
   - Server Members Intent
   - Message Content Intent (optional)
6. Invite the bot to your server with these permissions:
   - Send Messages
   - Embed Links
7. Get the channel ID where you want updates:
   - Enable Developer Mode in Discord settings
   - Right-click the channel and "Copy ID"

## How It Works

1. **Process Detection**: The app scans running processes to find `LeagueClientUx`
2. **LCU Connection**: Extracts connection details (port, auth token) from process arguments
3. **WebSocket**: Connects to the LCU WebSocket API at `wss://127.0.0.1:<port>`
4. **Event Subscription**: Subscribes to game flow, champion select, and end-of-game events
5. **Event Parsing**: Parses incoming WebSocket messages and extracts relevant game data
6. **Discord Posting**: Formats events as Discord messages and posts via the Discord API

## Development Notes

- The LCU API uses a self-signed certificate, so TLS verification is disabled
- WebSocket connection requires basic authentication with `riot:<token>`
- The app must run while League is active to monitor games
- Events are processed in real-time with minimal delay

## Future Enhancements

- [ ] Rich embeds for Discord messages
- [ ] Configurable event filters
- [ ] Multiple Discord channel support
- [ ] Champion select detailed info
- [ ] In-game statistics tracking
- [ ] Custom notification sounds
- [ ] System tray integration
- [ ] Settings persistence
- [ ] Multi-language support

## Troubleshooting

### Can't connect to League Client

- Make sure League of Legends is running
- Try restarting the League client
- Check if another application is interfering

### Discord messages not posting

- Verify your bot token is correct
- Ensure the bot has permissions in the channel
- Check the channel ID is correct
- View debug logs for error messages

### Build errors

- Ensure Rust is up to date: `rustup update`
- Clear build cache: `cargo clean`
- Make sure all dependencies are installed

## License

GPL-3.0-only

## Links

- [Main Repository](https://github.com/shepherdjerred/scout-for-lol)
- [Tauri Documentation](https://tauri.app/)
- [LCU API Documentation](https://hextechdocs.dev/)
