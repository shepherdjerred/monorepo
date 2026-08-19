---
title: Mobile Setup
description: Install and configure clauderon mobile apps
---

**The native apps are in development.** For immediate access, use the [Web UI](/guides/web-ui/).

## Prerequisites

1. clauderon daemon running and accessible from the internet (or VPN)
2. HTTPS recommended; WebAuthn enabled for authentication

## Server Configuration

### 1. Enable Remote Access

**Reverse Proxy (Recommended):**

```nginx
server {
    listen 443 ssl;
    server_name clauderon.yourdomain.com;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    location / {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Direct Binding (testing only):**

```bash
CLAUDERON_BIND_ADDR=0.0.0.0 clauderon daemon
```

### 2. Enable Authentication

```bash
clauderon daemon --enable-webauthn-auth
```

```toml
# ~/.clauderon/config.toml
[feature_flags]
webauthn_auth = true
```

### 3. Configure Origin

```bash
CLAUDERON_ORIGIN=https://clauderon.yourdomain.com clauderon daemon
```

## Building from Source

### Prerequisites

| Platform   | Requirements                                  |
| ---------- | --------------------------------------------- |
| All        | Node.js 18+ or Bun, React Native CLI, Git     |
| iOS/iPadOS | macOS, Xcode 14+, CocoaPods                   |
| Android    | Android Studio, Android SDK, JDK 17+          |
| macOS      | macOS, Xcode 14+                              |
| Windows    | Windows 10+, Visual Studio 2019+, Windows SDK |

### Build

```bash
cd clauderon/mobile
bun install

# iOS
cd ios && pod install && cd .. && bun run ios

# Android
bun run android

# macOS
bun run macos

# Windows
bun run windows
```

## App Configuration

1. Open app, tap "Add Server"
2. Enter server URL: `https://clauderon.yourdomain.com`
3. Tap "Connect", then "Sign In" with passkey/biometric
4. First-time passkey: register via desktop Web UI (Settings > Security)

Multiple servers supported via header server switcher.

## Push Notifications

| Event             | Default |
| ----------------- | ------- |
| Session completed | On      |
| Session errors    | On      |
| New chat messages | Off     |
| Session started   | Off     |

## App Permissions

| Permission                | Platform    | Purpose                  |
| ------------------------- | ----------- | ------------------------ |
| Face ID / Touch ID        | iOS/iPadOS  | Biometric authentication |
| Fingerprint / Face Unlock | Android     | Biometric authentication |
| Windows Hello             | Windows     | Biometric authentication |
| Notifications             | iOS/Android | Push notifications       |
| Network                   | All         | Server communication     |
| Camera                    | Mobile      | QR code scanning         |

## Troubleshooting

| Problem               | Solution                                                                       |
| --------------------- | ------------------------------------------------------------------------------ |
| Can't connect         | Verify URL; `curl https://clauderon.yourdomain.com/health`; check firewall/TLS |
| Auth failed           | Ensure WebAuthn enabled; re-register passkey from desktop                      |
| No push notifications | Check device notification permissions; re-enable in app                        |
| WebSocket disconnects | App auto-reconnects; check server WebSocket config                             |
| App crashes           | Update to latest; clear app data and re-authenticate                           |
