---
title: Mobile Apps
description: Native mobile applications for clauderon
---

React Native apps for iOS, Android, macOS, and Windows.

:::caution
Mobile apps are in active development and not yet published to app stores. Build from source to try them out.
:::

## Platforms

| Platform     | Minimum | Status         |
| ------------ | ------- | -------------- |
| iOS/iPadOS   | 16+     | In development |
| Android      | 10+     | In development |
| macOS        | 11+     | In development |
| Windows      | 10+     | In development |

**For immediate access**, use the Web UI -- fully functional, mobile-responsive, no install required.

## Features

- Session management (create, archive, delete, monitor)
- Real-time chat with agents
- Push notifications for session events
- Remote connection via HTTPS with WebAuthn

## Architecture

```
┌──────────────────┐     HTTPS/WSS      ┌──────────────────┐
│   Mobile App     │ ◄────────────────► │ clauderon daemon │
│  (iOS/Android)   │                    │   (your server)  │
└──────────────────┘                    └──────────────────┘
```

Connects via REST API (session management) and WebSocket (real-time updates, chat).

## Security

- WebAuthn/Passkeys for authentication
- TLS encryption, certificate pinning available
- No session data stored on device, no telemetry

## Mobile App vs Web UI

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

## Limitations

- No terminal attach (view only)
- Requires network connection to daemon
- Daemon must be internet-accessible (or VPN)

See [Mobile Setup](/mobile/setup/) for installation.
