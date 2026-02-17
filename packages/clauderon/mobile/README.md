# Clauderon Mobile

React Native mobile app for Clauderon, targeting iOS, Android, macOS, and Windows.

## Features

- **Chat Interface**: Interact with Claude Code sessions via a mobile-friendly chat interface
- **Session Management**: View and manage all your Clauderon sessions
- **Real-time Updates**: WebSocket-based live updates for session changes
- **Type Safety**: Full TypeScript integration with types generated from Rust backend
- **Cross-platform**: Supports iOS, Android, iPad, macOS, and Windows

## Platform Support

✅ **Fully Supported:**

- iOS (15.1+)
- Android (API 24+)
- iPad (universal iOS app)
- macOS (12.0+)
- Windows (10/11)

See [PLATFORM_SUPPORT.md](./PLATFORM_SUPPORT.md) for detailed platform-specific instructions and build guides.

## System Requirements

> **This project uses React Native 0.81.5 with React 19.2**
>
> Note: Downgraded from 0.83 to support macOS and Windows. Desktop platforms lag behind core React Native releases.

### All Platforms

| Requirement | Version                | Notes                               |
| ----------- | ---------------------- | ----------------------------------- |
| Node.js     | >= 20.19.4             | Minimum required by RN 0.81+        |
| Node.js     | 24.x LTS (recommended) | Active LTS "Krypton" - best support |
| Watchman    | Latest                 | Recommended for file watching       |

### iOS Development (requires macOS)

| Requirement              | Version           | Notes                                                      |
| ------------------------ | ----------------- | ---------------------------------------------------------- |
| macOS                    | 26 Tahoe (latest) | Required for Xcode 26                                      |
| macOS                    | 15 Sequoia        | Required for Xcode 16.x                                    |
| Xcode                    | 16.4 (stable)     | Recommended for React Native stability                     |
| Xcode                    | 26.2 (latest)     | Has RN issues; requires `SWIFT_ENABLE_EXPLICIT_MODULES=NO` |
| Xcode Command Line Tools | Latest            | Install via `xcode-select --install`                       |
| CocoaPods                | >= 1.13           | Avoid versions 1.15.0 and 1.15.1                           |
| Ruby                     | >= 2.7            | macOS ships with older version; upgrade recommended        |
| iOS Deployment Target    | 15.1              | Minimum iOS version (since RN 0.76)                        |
| iOS SDK                  | 18+ or 26         | Depending on Xcode version                                 |

> **Xcode 26 Note:** As of January 2026, Xcode 26.2 is the latest but has known React Native compatibility issues. Prebuilt binaries don't work due to Swift explicit modules. Either use Xcode 16.4 for stability, or set `SWIFT_ENABLE_EXPLICIT_MODULES=NO` in your Xcode project when using Xcode 26.

### Android Development

| Requirement         | Version                     | Notes                                             |
| ------------------- | --------------------------- | ------------------------------------------------- |
| JDK                 | 17                          | Higher versions may cause issues                  |
| Android Studio      | Latest (Ladybug+)           | With SDK Manager                                  |
| Android SDK         | Platform 35+                | Google Play requires targetSdk 35+ since Aug 2025 |
| Android SDK         | Platform 36 (Android 16)    | Latest available (Baklava)                        |
| Android SDK         | Platform 24+ (Android 7.0+) | Minimum supported                                 |
| Android Build Tools | 35.0.0 or 36.0.0            | Match your target SDK                             |

### Windows Development

| Requirement   | Version        | Notes                               |
| ------------- | -------------- | ----------------------------------- |
| Windows       | 10/11 (64-bit) | Latest updates required             |
| Visual Studio | 2022           | With specific workloads (see below) |
| Windows SDK   | 10.0.22621.0+  |                                     |
| .NET SDK      | 6.0+           |                                     |

### Hardware Recommendations

- **CPU**: Quad-core or better
- **RAM**: 16 GB recommended (8 GB minimum)
- **Storage**: 30 GB free space (SSD recommended)

## Environment Setup

### macOS Setup (for iOS/Android/macOS development)

#### 1. Install Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### 2. Install Node.js and Watchman

```bash
brew install node
brew install watchman
```

#### 3. Install JDK 17 (for Android)

```bash
brew install --cask zulu@17

# Add to ~/.zshrc or ~/.bash_profile
export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home
```

#### 4. Install Xcode (for iOS/macOS)

1. Install Xcode from the Mac App Store
2. Open Xcode and accept the license agreement
3. Install Command Line Tools:
   ```bash
   xcode-select --install
   ```
4. Configure Command Line Tools path:
   - Open Xcode → Settings → Locations
   - Select the latest version in "Command Line Tools" dropdown

#### 5. Install iOS Simulators

1. Open Xcode → Settings → Platforms (or Components)
2. Click the "+" icon
3. Select iOS and download desired simulator versions

#### 6. Install CocoaPods

**Option A: Via Homebrew (recommended for Apple Silicon)**

```bash
brew install cocoapods
```

**Option B: Via Ruby gem**

```bash
sudo gem install cocoapods
```

**Option C: Via Bundler (most reliable)**

```bash
# In project root, create Gemfile if not exists
cat > Gemfile << 'EOF'
source 'https://rubygems.org'
gem 'cocoapods', '>= 1.13', '!= 1.15.0', '!= 1.15.1'
gem 'activesupport', '>= 6.1.7.5', '!= 7.1.0'
EOF

bundle install
```

#### 7. Install Android Studio (for Android)

1. Download from [developer.android.com/studio](https://developer.android.com/studio)
2. During installation, ensure these are checked:
   - Android SDK
   - Android SDK Platform
   - Android Virtual Device
3. Open SDK Manager (Tools → SDK Manager) and install:
   - SDK Platforms tab: Android 15 (VanillaIceCream) - API 35 (required for Google Play)
   - SDK Platforms tab: Android 16 (Baklava) - API 36 (optional, latest)
   - SDK Tools tab: Android SDK Build-Tools 35.0.0
4. Configure environment variables in `~/.zshrc`:
   ```bash
   export ANDROID_HOME=$HOME/Library/Android/sdk
   export PATH=$PATH:$ANDROID_HOME/emulator
   export PATH=$PATH:$ANDROID_HOME/platform-tools
   ```

### Windows Setup (for Android/Windows development)

#### 1. Install Chocolatey

```powershell
# Run as Administrator
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
```

#### 2. Install Node.js and JDK

```powershell
choco install nodejs-lts
choco install microsoft-openjdk17
```

#### 3. Install Android Studio

Download and install from [developer.android.com/studio](https://developer.android.com/studio)

Set environment variables:

- `ANDROID_HOME`: `%LOCALAPPDATA%\Android\Sdk`
- Add to Path: `%LOCALAPPDATA%\Android\Sdk\platform-tools`

#### 4. Install Visual Studio 2022 (for Windows app development)

Install with these workloads:

- Node.js development
- .NET Desktop development
- Desktop development with C++
- Universal Windows Platform development

Required components:

- MSVC v143 - VS 2022 C++ x64/x86 build tools
- C++ (v143) Universal Windows Platform tools

#### 5. Enable Developer Mode

Settings → Privacy & Security → For developers → Developer Mode: On

#### 6. Enable Long Paths

```powershell
# Run as Administrator
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

## Project Setup

### 1. Install Dependencies

```bash
bun install
# or
npm install
```

### 2. Install iOS Dependencies (CocoaPods)

```bash
cd ios && pod install && cd ..

# If using Bundler:
cd ios && bundle exec pod install && cd ..
```

### 3. Configure Daemon URL

1. Launch the app
2. Go to Settings tab
3. Enter your Clauderon daemon URL (e.g., `http://192.168.1.100:3030`)
4. Tap "Save URL"
5. Tap "Test Connection" to verify

## Running the App

### Start Metro Bundler

In a separate terminal, start the JavaScript bundler:

```bash
bun start
# or
npm start

# Clear cache if needed:
bun start -- --reset-cache
```

---

## iOS

### Running on iOS Simulator

**Default simulator (iPhone 14):**

```bash
bun run ios
```

**List available simulators:**

```bash
xcrun simctl list devices available
```

**Run on specific simulator:**

```bash
bun run ios -- --simulator "iPhone 17"
bun run ios -- --simulator "iPhone SE (3rd generation)"
bun run ios -- --simulator "iPad Pro 13-inch (M5)"
```

**Run on specific simulator by UDID:**

```bash
# Get UDID from: xcrun simctl list devices
bun run ios -- --udid XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
```

**Interactive device selection:**

```bash
bun run ios -- --list-devices
```

**Other useful flags:**

```bash
bun run ios -- --mode Release           # Build in release mode
bun run ios -- --scheme MyScheme        # Use specific Xcode scheme
bun run ios -- --no-packager            # Don't start Metro bundler
bun run ios -- --port 8082              # Use different Metro port
bun run ios -- --verbose                # Show detailed build output
```

### Running on Physical iOS Device

#### Prerequisites

1. **Apple Developer Account** - Free account works for development
2. **USB cable** - Lightning or USB-C depending on device
3. **Developer Mode enabled on device**

#### Enable Developer Mode on iPhone/iPad

1. Connect device to Mac at least once
2. On device: Settings → Privacy & Security → Developer Mode
3. Enable Developer Mode
4. Tap Restart when prompted
5. After restart, confirm by tapping "Turn On"

#### Configure Code Signing in Xcode

1. Open `ios/ClauderonMobile.xcworkspace` in Xcode
2. Select the project in the navigator (blue icon)
3. Select "ClauderonMobile" target
4. Go to "Signing & Capabilities" tab
5. Check "Automatically manage signing"
6. Select your Team from the dropdown
7. **Repeat for "ClauderonMobileTests" target**

#### Build and Run

**Option A: Via command line**

```bash
# List connected devices
xcrun devicectl list devices

# Run on device by name
bun run ios -- --device "Your-iPhone-Name"

# Run on device by UDID
bun run ios -- --udid XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX

# Interactive selection (shows all simulators and devices)
bun run ios -- --list-devices
```

**Option B: Via Xcode**

1. Open `ios/ClauderonMobile.xcworkspace`
2. Select your device in the toolbar dropdown
3. Press Cmd+R or Product → Run

#### Trust Developer Certificate (first time only)

If you see "Untrusted Developer" on device:

1. On device: Settings → General → VPN & Device Management
2. Find your developer profile
3. Tap "Trust"

#### Development Server Connection (Physical Device)

Your Mac and iOS device must be on the same Wi-Fi network.

1. Find your Mac's IP: System Settings → Network
2. Shake device to open Dev Menu
3. Enable "Fast Refresh"
4. If issues, check the embedded IP matches your Mac's IP

---

## Android

### Running on Android Emulator

#### Create an AVD (Android Virtual Device)

1. Open Android Studio
2. Tools → Device Manager
3. Click "Create Device"
4. Select hardware (e.g., Pixel 8)
5. Select system image (API 35 recommended for stability, or API 36 for latest)
6. Finish and launch the emulator

**Run on emulator:**

```bash
# Start emulator first, then:
bun run android
```

**List available emulators:**

```bash
emulator -list-avds
```

**Run on specific emulator:**

```bash
# Get device ID from: adb devices
bun run android -- --device emulator-5554
```

**Interactive device selection:**

```bash
bun run android -- --list-devices
# or
bun run android -- -i
```

**Other useful flags:**

```bash
bun run android -- --mode release       # Build in release mode
bun run android -- --no-packager        # Don't start Metro bundler
bun run android -- --port 8082          # Use different Metro port
bun run android -- --active-arch-only   # Build only for current device arch (faster)
```

### Running on Physical Android Device

#### Enable USB Debugging

1. Settings → About phone → Software information
2. Tap "Build number" 7 times (enables Developer options)
3. Settings → Developer options → Enable "USB debugging"

#### Connect and Verify

```bash
# Connect device via USB, then:
adb devices

# Should show your device:
# List of devices attached
# ABC123DEF456    device
```

#### Run on Device

```bash
bun run android
```

If multiple devices connected:

```bash
# Use --device (--deviceId is deprecated)
bun run android -- --device ABC123DEF456

# Or use interactive selection
bun run android -- -i
```

#### Development Server Connection (Physical Device)

**Option A: adb reverse (recommended, requires USB)**

```bash
adb reverse tcp:8081 tcp:8081
```

**Option B: Wi-Fi connection**

1. Ensure phone and computer on same network
2. Open app on device
3. Shake to open Dev Menu
4. Dev Settings → Debug server host & port
5. Enter `YOUR_COMPUTER_IP:8081`
6. Reload JS

---

## macOS

### Requirements

- macOS Big Sur (11) or newer
- Xcode (same as iOS requirements)
- CocoaPods installed

### Running on macOS

```bash
bun run macos
```

The app runs as a native macOS window application.

---

## Windows

### Requirements

- Windows 10/11 (64-bit)
- Visual Studio 2022 with required workloads
- Windows SDK 10.0.22621.0
- .NET SDK 6.0+

### Running on Windows

```bash
bun run windows
```

Or open the solution in Visual Studio:

1. Open `windows/ClauderonMobile.sln`
2. Select Debug configuration and x64 platform
3. Ensure Metro bundler is running (`bun start`)
4. Press F5 or click Run

---

## Troubleshooting

### CocoaPods Issues

**"pod install" fails or hangs:**

```bash
# Update CocoaPods repo
pod repo update

# Clean and reinstall
cd ios
rm -rf Pods Podfile.lock
pod install --repo-update
```

**Ruby version mismatch:**

```bash
# Install rbenv for Ruby version management
brew install rbenv
rbenv install 3.2.0
rbenv global 3.2.0

# Reinstall CocoaPods
gem install cocoapods
```

**M1/M2/M3 Mac architecture issues:**

```bash
# If you see ffi_c.bundle errors:
sudo arch -x86_64 gem install ffi

# Or run pod install with Rosetta:
arch -x86_64 pod install
```

**"activesupport" or "logger" errors:**

```bash
bundle pristine
bundle update activesupport cocoapods
```

### iOS Build Issues

**Code signing errors:**

1. Open Xcode
2. Ensure Team is selected in Signing & Capabilities
3. Try: Product → Clean Build Folder (Cmd+Shift+K)
4. Delete DerivedData: `rm -rf ~/Library/Developer/Xcode/DerivedData`

**Device not appearing:**

1. Ensure device is unlocked
2. Trust the computer when prompted on device
3. Check cable connection
4. Restart Xcode

**"Unable to find destination" errors:**

```bash
# List available destinations
xcodebuild -workspace ios/ClauderonMobile.xcworkspace -scheme ClauderonMobile -showdestinations
```

### Xcode 26 / iOS 26 Issues

**Prebuilt binaries fail with Swift explicit modules:**

```bash
# In Xcode: Build Settings → Swift Compiler - General
# Set "Explicitly Built Modules" to NO

# Or via xcodebuild:
xcodebuild SWIFT_ENABLE_EXPLICIT_MODULES=NO ...
```

**ALAssetsLibrary deprecation errors:**
This is a known issue with iOS 26. Libraries using `ALAssetsLibrary` need to migrate to `PHPhotoLibrary`. Check for library updates or file issues with the library maintainers.

**Build fails on Xcode 26:**
If you encounter persistent issues, consider using Xcode 16.4 for stability (requires macOS 15 Sequoia):

```bash
# Switch Xcode version (if you have both installed)
sudo xcode-select -s /Applications/Xcode-16.4.app

# Check current Xcode
xcode-select -p
```

### Android Build Issues

**Gradle build fails:**

```bash
cd android
./gradlew clean
cd ..
bun run android
```

**JAVA_HOME not set:**

```bash
# Add to ~/.zshrc
export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home
```

**Device not recognized:**

```bash
# Restart ADB
adb kill-server
adb start-server
adb devices
```

### Metro Bundler Issues

**Port already in use:**

```bash
# Kill process on port 8081
lsof -i :8081
kill -9 <PID>

# Or use different port
bun start -- --port 8082
bun run ios -- --port 8082
```

**Cache issues:**

```bash
# Clear all caches
watchman watch-del-all
rm -rf node_modules
rm -rf /tmp/metro-*
bun install
cd ios && pod install && cd ..
bun start -- --reset-cache
```

### Connection Issues

**Cannot connect to daemon:**

- Ensure daemon URL is correct (include `http://` prefix)
- Verify daemon is running and accessible from device
- Check network/firewall settings
- For local network: use IP address, not `localhost`
- Ensure device and computer are on same network

**Type errors:**

- Run `cargo build` in clauderon package to regenerate types
- Symlink may need recreation if types directory is missing

---

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

- Minimum iOS version: 15.1 (since React Native 0.76)
- Requires Xcode 16.4 (stable) or Xcode 26.2 (latest with workarounds)
- iOS 26 SDK available but has known RN compatibility issues
- Requires local network permission for accessing daemon on LAN
- Uses native WebSocket implementation

### Android

- Minimum SDK: 24 (Android 7.0)
- Target SDK: 35+ (required for Google Play since Aug 2025)
- Latest SDK: 36 (Android 16 "Baklava")
- Requires INTERNET permission
- Cleartext traffic enabled for HTTP daemon access
- 16KB page size compliant (required for Android 15+ apps since Nov 2025)

### macOS

- Requires macOS 15 Sequoia for Xcode 16.x
- Requires macOS 26 Tahoe for Xcode 26
- Requires network client entitlement
- Native window management

### Windows

- Requires Windows 10/11 (64-bit)
- Requires Visual Studio 2022
- UWP or Win32 depending on configuration
- Network capabilities in AppxManifest

## Useful Commands Reference

```bash
# Environment Check (run this first!)
npx react-native doctor                      # Diagnose environment issues
npx react-native info                        # Show environment info

# iOS
xcrun simctl list devices                    # List simulators
xcrun devicectl list devices                 # List physical devices
xcodebuild -showsdks                         # List installed SDKs
xcode-select -p                              # Show active Xcode path

# Android
adb devices                                   # List connected devices
emulator -list-avds                          # List emulators
adb reverse tcp:8081 tcp:8081                # Forward Metro port
adb kill-server && adb start-server          # Restart ADB

# Metro Bundler
bun start -- --reset-cache                   # Clear Metro cache
lsof -i :8081                                # Check what's using port 8081
```

## Resources

- [React Native 0.83 Release Notes](https://reactnative.dev/blog/2025/12/10/react-native-0.83)
- [React Native Documentation](https://reactnative.dev/docs/getting-started)
- [React Native Environment Setup](https://reactnative.dev/docs/set-up-your-environment)
- [Running on Device](https://reactnative.dev/docs/running-on-device)
- [Running on Simulator](https://reactnative.dev/docs/running-on-simulator-ios)
- [React Native Upgrade Helper](https://react-native-community.github.io/upgrade-helper/)
- [React Native CLI Documentation](https://github.com/react-native-community/cli/blob/main/docs/commands.md)
- [CocoaPods Getting Started](https://guides.cocoapods.org/using/getting-started.html)
- [React Native for Windows + macOS](https://microsoft.github.io/react-native-windows/)

## Future Enhancements

- Authentication (when backend adds support)
- Create session from mobile
- File uploads (attach images to prompts)
- Push notifications for session completion
- Offline mode with local caching
- Biometric app lock (FaceID/TouchID)
