---
title: Mobile Setup
description: Install and configure clauderon mobile apps
---

This guide covers setting up the clauderon mobile apps for iOS and Android.

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

## iOS Installation

### From App Store

1. Open App Store on your iPhone/iPad
2. Search for "clauderon"
3. Download and install

### TestFlight (Beta)

1. Join the beta at [link coming soon]
2. Install TestFlight if needed
3. Open the beta link

## Android Installation

### From Google Play

1. Open Google Play Store
2. Search for "clauderon"
3. Install the app

### APK (Sideload)

1. Download APK from [releases]
2. Enable "Install unknown apps" for your browser
3. Install the APK

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

| Event | Default |
|-------|---------|
| Session completed | On |
| Session errors | On |
| New chat messages | Off |
| Session started | Off |

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

| Permission | Purpose |
|------------|---------|
| Face ID / Touch ID | Biometric authentication |
| Notifications | Push notifications |
| Network | Server communication |
| Camera | QR code scanning (optional) |

## See Also

- [Mobile Overview](/mobile/overview/) - Feature overview
- [Web Interface](/guides/web-ui/) - Browser-based alternative
- [Configuration Reference](/reference/configuration/) - Server configuration
