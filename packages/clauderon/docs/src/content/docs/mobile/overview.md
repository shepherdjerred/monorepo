---
title: Mobile Apps
description: Native mobile applications for clauderon
---

clauderon provides native iOS and Android apps for managing sessions on the go.

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

### iOS

- iOS 16+
- iPhone and iPad
- Available on App Store (coming soon)

### Android

- Android 10+
- Phone and tablet
- Available on Google Play (coming soon)

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

| Feature | Mobile App | Web UI |
|---------|------------|--------|
| Platform | iOS/Android | Any browser |
| Push notifications | Yes | No |
| Offline access | Session list cached | No |
| Biometric auth | Yes | WebAuthn |
| Performance | Native | Web |
| Installation | App store | None |

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
