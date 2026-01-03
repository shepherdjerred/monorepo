# Clauderon Mobile

React Native mobile app for Clauderon, targeting iOS, Android, macOS, and Windows.

## Features

- **Chat Interface**: Interact with Claude Code sessions via a mobile-friendly chat interface
- **Session Management**: View and manage all your Clauderon sessions
- **Real-time Updates**: WebSocket-based live updates for session changes
- **Type Safety**: Full TypeScript integration with types generated from Rust backend
- **Cross-platform**: Supports iOS, Android, macOS, and Windows

## Prerequisites

- Node.js >= 18
- React Native development environment set up
  - For iOS: Xcode, CocoaPods
  - For Android: Android Studio, JDK
  - For macOS: Xcode
  - For Windows: Visual Studio with C++ tools

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. For iOS, install CocoaPods:
   ```bash
   cd ios && pod install && cd ..
   ```

3. Configure daemon URL:
   - Launch the app
   - Go to Settings tab
   - Enter your Clauderon daemon URL (e.g., `http://192.168.1.100:3030`)
   - Tap "Save URL"
   - Tap "Test Connection" to verify

## Development

Start the Metro bundler:
```bash
npm start
```

Run on iOS:
```bash
npm run ios
```

Run on Android:
```bash
npm run android
```

Run on macOS:
```bash
npm run macos
```

Run on Windows:
```bash
npm run windows
```

## Architecture

The app is structured to mirror the web frontend:

- **API Clients**: HTTP and WebSocket clients for backend communication
- **Type Sharing**: TypeScript types generated from Rust via typeshare (symlinked from `../web/shared/src/generated`)
- **State Management**: React Context API for global session state
- **Navigation**: React Navigation with stack and bottom tabs
- **UI**: Brutalist design matching the web frontend

### Key Files

- `src/api/` - API clients (ClauderonClient, ConsoleClient, EventsClient)
- `src/contexts/SessionContext.tsx` - Global session state
- `src/screens/` - Main screens (SessionList, Chat, Settings)
- `src/components/` - Reusable UI components
- `src/styles/` - Brutalist design system (colors, typography)
- `src/lib/claudeParser.ts` - PTY output parser for chat messages

## Type Safety

Types are shared with the Rust backend via typeshare:

1. Rust types are annotated with `#[typeshare]`
2. `cargo build` generates TypeScript types to `../web/shared/src/generated/index.ts`
3. Mobile app symlinks to these types via `src/types/generated/index.ts`

Any changes to Rust types automatically flow to the mobile app.

## Configuration

### Daemon URL

The app stores the daemon URL in AsyncStorage. Configure it via Settings screen.

### Network Security

- **iOS**: `Info.plist` allows HTTP for local network access
- **Android**: Network security config allows cleartext HTTP for local IPs

## Platform-Specific Notes

### iOS

- Minimum iOS version: 13.4
- Requires local network permission for accessing daemon on LAN
- Uses native WebSocket implementation

### Android

- Minimum SDK: 21 (Android 5.0)
- Requires INTERNET permission
- Cleartext traffic enabled for HTTP daemon access

### macOS

- Requires network client entitlement
- Native window management

### Windows

- UWP or Win32 depending on configuration
- Network capabilities in AppxManifest

## Troubleshooting

**Cannot connect to daemon:**
- Ensure daemon URL is correct (include `http://` prefix)
- Verify daemon is running and accessible from mobile device
- Check network/firewall settings
- For local network: use IP address, not `localhost`

**Type errors:**
- Run `cargo build` in clauderon package to regenerate types
- Symlink may need recreation if types directory is missing

**Build errors:**
- iOS: `cd ios && pod install`
- Android: `cd android && ./gradlew clean`
- Clear Metro cache: `npm start -- --reset-cache`

## Future Enhancements

- Authentication (when backend adds support)
- Create session from mobile
- File uploads (attach images to prompts)
- Push notifications for session completion
- Offline mode with local caching
- Biometric app lock (FaceID/TouchID)
