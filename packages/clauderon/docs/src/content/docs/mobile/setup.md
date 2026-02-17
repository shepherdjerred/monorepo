---
title: Mobile Setup
description: Install and configure clauderon mobile apps
---

This guide covers setting up the clauderon applications for iOS, iPadOS, Android, macOS, and Windows.

**Important:** The native apps are currently in development. For immediate access to all features, use the [Web UI](/guides/web-ui/) which works on all devices and browsers.

## Prerequisites

1. clauderon daemon running on a server
2. Server accessible from the internet (or VPN)
3. HTTPS configured (recommended) or WebAuthn enabled

## Server Configuration

### 1. Enable Remote Access

By default, clauderon binds to localhost. For mobile access, you need to expose it.

#### Option A: Reverse Proxy (Recommended)

Use nginx or another reverse proxy with TLS:

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

#### Option B: Direct Binding

For testing only (not recommended for production):

```bash
CLAUDERON_BIND_ADDR=0.0.0.0 clauderon daemon
```

### 2. Enable Authentication

For remote access, enable WebAuthn authentication:

```bash
clauderon daemon --enable-webauthn-auth
```

Or in config:

```toml
# ~/.clauderon/config.toml
[features]
webauthn_auth = true
```

### 3. Configure Origin

Set the WebAuthn origin to match your domain:

```bash
CLAUDERON_ORIGIN=https://clauderon.yourdomain.com clauderon daemon
```

## Building from Source

If you want to test the apps in development, you can build from source.

### Prerequisites

**All Platforms:**

- Node.js 18+ or Bun
- React Native CLI
- Git

**iOS/iPadOS:**

- macOS with Xcode 14+
- CocoaPods (`gem install cocoapods`)
- iOS Simulator or physical device

**Android:**

- Android Studio with Android SDK
- Java Development Kit (JDK) 17+
- Android emulator or physical device

**macOS:**

- macOS with Xcode 14+
- React Native macOS dependencies

**Windows:**

- Windows 10+ with Visual Studio 2019+
- Windows SDK
- React Native Windows dependencies

### Build Steps

```bash
# Clone repository
git clone https://github.com/yourusername/clauderon
cd clauderon/mobile

# Install dependencies
bun install

# iOS (requires macOS)
cd ios && pod install && cd ..
bun run ios

# Android
bun run android

# macOS (requires macOS)
bun run macos

# Windows (requires Windows)
bun run windows
```

### Development Server

For development, the app connects to your local clauderon daemon:

```bash
# Terminal 1: Start clauderon daemon
clauderon serve

# Terminal 2: Start React Native
cd mobile
bun run ios  # or android/macos/windows
```

## Platform-Specific Setup

### iOS & iPadOS

**Status:** In active development

**Current Options:**

1. **Web UI (Recommended)** - Visit your clauderon server in Safari
   - Add to Home Screen for app-like experience
   - Full feature parity with desktop
   - Responsive design for iPhone and iPad

2. **Build from Source** - For developers who want to test
   ```bash
   cd mobile
   bun install
   bun run ios
   ```

**Future Availability:**

- App Store release planned after beta testing phase
- TestFlight beta program (join waitlist on GitHub)

### Android

**Status:** In active development

**Current Options:**

1. **Web UI (Recommended)** - Visit your clauderon server in Chrome/Firefox
   - Add to Home Screen for app-like experience
   - Full feature parity with desktop
   - Responsive design for phones and tablets

2. **Build from Source** - For developers who want to test
   ```bash
   cd mobile
   bun install
   bun run android
   ```

**Future Availability:**

- Google Play release planned after beta testing phase
- Direct APK downloads may be available before Play Store release

### macOS

**Status:** In active development

**Current Options:**

1. **Web UI** - Visit your clauderon server in any browser
2. **CLI/TUI** - Full desktop experience via terminal

   ```bash
   # Install via cargo
   cargo install clauderon

   # Use TUI
   clauderon tui
   ```

3. **Build React Native macOS App from Source**
   ```bash
   cd mobile
   bun install
   bun run macos
   ```

### Windows

**Status:** In active development

**Current Options:**

1. **Web UI** - Visit your clauderon server in any browser
2. **CLI** - Windows support via WSL or native Windows build

   ```bash
   # Via cargo
   cargo install clauderon
   ```

3. **Build React Native Windows App from Source**
   ```bash
   cd mobile
   bun install
   bun run windows
   ```

**Future Availability:**

- Direct download installers (.exe)
- Microsoft Store consideration (after initial release)

## App Configuration

### 1. Add Server

1. Open the clauderon app
2. Tap "Add Server"
3. Enter your server URL:
   ```
   https://clauderon.yourdomain.com
   ```
4. Tap "Connect"

### 2. Authenticate

1. Tap "Sign In"
2. Use your passkey/biometric to authenticate
3. Allow biometric access for future logins

### 3. Register Passkey (First Time)

If this is your first device:

1. Open the web UI on desktop
2. Go to Settings > Security
3. Register a passkey
4. Use the same passkey on mobile

## Multiple Servers

You can add multiple clauderon servers:

1. Tap the server name in the header
2. Tap "Add Server"
3. Enter the new server URL
4. Switch between servers via the header

## Push Notifications

### Enable Notifications

1. Go to app Settings
2. Enable "Push Notifications"
3. Choose which events to notify:
   - Session completed
   - Session errors
   - Chat messages

### Notification Settings

| Event             | Default |
| ----------------- | ------- |
| Session completed | On      |
| Session errors    | On      |
| New chat messages | Off     |
| Session started   | Off     |

## Offline Mode

The app caches basic session information for offline viewing:

- Session list
- Session metadata
- Recent chat messages (limited)

Full functionality requires connection to your server.

## Troubleshooting

### Can't Connect to Server

1. Verify server URL is correct
2. Check server is accessible:
   ```bash
   curl https://clauderon.yourdomain.com/health
   ```
3. Check firewall allows connection
4. Verify TLS certificate is valid

### Authentication Failed

1. Ensure WebAuthn is enabled on server
2. Try registering passkey again from desktop
3. Check device supports WebAuthn/Passkeys
4. Ensure biometrics are set up on device

### Push Notifications Not Working

1. Check notification permissions in device settings
2. Verify server can send notifications
3. Re-enable notifications in app settings

### WebSocket Disconnects

1. Check network stability
2. App auto-reconnects when network returns
3. Check server WebSocket configuration

### App Crashes

1. Update to latest version
2. Clear app data and re-authenticate
3. Report issue with crash logs

## VPN Configuration

If your server is only accessible via VPN:

1. Connect to VPN before opening app
2. Add server while connected
3. App will attempt reconnect if VPN disconnects

## Security Best Practices

### Do

- Use HTTPS with valid certificates
- Enable WebAuthn authentication
- Use VPN for internal servers
- Keep app updated

### Don't

- Expose daemon without authentication
- Use self-signed certificates without pinning
- Connect over public WiFi without VPN
- Share passkeys between users

## App Permissions

| Permission                | Platform    | Purpose                        |
| ------------------------- | ----------- | ------------------------------ |
| Face ID / Touch ID        | iOS/iPadOS  | Biometric authentication       |
| Fingerprint / Face Unlock | Android     | Biometric authentication       |
| Windows Hello             | Windows     | Biometric authentication       |
| Notifications             | iOS/Android | Push notifications             |
| Network                   | All         | Server communication           |
| Camera                    | Mobile      | QR code scanning (optional)    |
| File System               | Desktop     | Session file access (optional) |

## See Also

- [Mobile Overview](/mobile/overview/) - Feature overview
- [Web Interface](/guides/web-ui/) - Browser-based alternative
- [Configuration Reference](/reference/configuration/) - Server configuration
