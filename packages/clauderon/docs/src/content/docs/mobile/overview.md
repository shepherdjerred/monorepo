---
title: Mobile Apps
description: Native mobile applications for clauderon
---

clauderon provides native mobile and desktop applications for managing sessions on the go, built with React Native to support iOS, Android, macOS, and Windows platforms.

## Features

### Session Management

- View all active and archived sessions
- Create new sessions
- Archive and delete sessions
- Monitor session status

### Real-time Chat

- View chat history
- Continue conversations with agents
- Send new prompts
- View tool calls and results

### Notifications

- Push notifications for session events
- Session completion alerts
- Error notifications

### Remote Access

- Connect to your clauderon daemon remotely
- Secure connection via HTTPS
- WebAuthn authentication support

## Platforms

The clauderon React Native app supports multiple platforms:

### iOS & iPadOS

- **iOS 16+** - iPhone support
- **iPadOS 16+** - iPad optimized UI with split view support
- **Installation** - App Store (in development)

### Android

- **Android 10+** - Phone and tablet support
- **Responsive UI** - Adapts to screen size automatically
- **Installation** - Google Play (in development)

### macOS

- **macOS 11+** - Native macOS app via React Native macOS
- **Desktop experience** - Full keyboard shortcuts and menu bar integration
- **Installation** - Direct download or build from source

### Windows

- **Windows 10+** - Native Windows app via React Native Windows
- **Desktop experience** - Native Windows controls and notifications
- **Installation** - Direct download or build from source

### Current Status

**Mobile and desktop apps are currently in active development.** While the codebase exists in the `mobile/` directory, the apps are not yet published to app stores or available for download.

**For immediate access**, use the Web UI which is fully functional and mobile-responsive:

- Works in any modern browser (Safari, Chrome, Firefox, Edge)
- Responsive design optimized for mobile screens
- All features available (session management, chat, configuration)
- No installation required

Follow development progress or contribute at [GitHub repository link].

## Screenshots

### Session List

View all your sessions with status indicators, backend types, and agents.

### Session Detail

Full chat history with syntax highlighting for code blocks.

### Create Session

Repository selection, prompt input, and configuration options.

## Architecture

Mobile apps connect to your clauderon daemon via:

1. **REST API** - Session management, configuration
2. **WebSocket** - Real-time updates, chat streaming

```
┌──────────────────┐     HTTPS/WSS      ┌──────────────────┐
│   Mobile App     │ ◄────────────────► │ clauderon daemon │
│  (iOS/Android)   │                    │   (your server)  │
└──────────────────┘                    └──────────────────┘
```

## Security

### Authentication

- WebAuthn/Passkeys for passwordless login
- Biometric authentication (Face ID, fingerprint)
- No passwords stored on device

### Network

- TLS encryption for all connections
- Certificate pinning available
- No data stored on mobile device

### Privacy

- Session data stays on your server
- No telemetry or tracking
- Open source apps

## Comparison with Web UI

| Feature             | Mobile/Desktop App                     | Web UI        |
| ------------------- | -------------------------------------- | ------------- |
| Platform            | iOS/iPadOS/Android/macOS/Windows       | Any browser   |
| Push notifications  | Yes (iOS/Android)                      | No            |
| Offline access      | Session list cached                    | No            |
| Biometric auth      | Yes (Face ID, Touch ID, Windows Hello) | WebAuthn      |
| Performance         | Native                                 | Web           |
| Installation        | App store/Download                     | None          |
| Terminal attach     | Limited (view only)                    | Full xterm.js |
| Multi-repo sessions | Planned                                | Yes           |

## Use Cases

### Check Session Progress

Monitor long-running AI tasks from your phone.

### Quick Session Creation

Start a new session while away from your computer.

### Notifications

Get alerted when important tasks complete.

### Review Chat History

Read what the agent did while you were away.

## Limitations

- Cannot attach to terminal (use desktop for that)
- Limited to viewing and basic interactions
- Requires network connection to daemon
- Daemon must be accessible from internet (or VPN)

## Getting Started

See the [Mobile Setup Guide](/mobile/setup/) for installation and configuration.

## See Also

- [Mobile Setup](/mobile/setup/) - Installation and configuration
- [Web Interface](/guides/web-ui/) - Browser-based alternative
- [API Reference](/reference/api/) - API used by mobile apps
