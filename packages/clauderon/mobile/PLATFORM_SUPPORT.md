# Platform Support for Clauderon Mobile

This document describes platform support, build instructions, and platform-specific considerations for the Clauderon Mobile application.

## Supported Platforms

Clauderon Mobile supports the following platforms:

- ✅ **Android** (API 24+, Android 7.0+)
- ✅ **iOS** (iOS 15.1+)
- ✅ **iPad** (Included with iOS build, universal app)
- ✅ **macOS** (macOS 12.0+)
- ✅ **Windows** (Windows 10 21H2+, Windows 11)

## React Native Version

- **React Native**: 0.81.5
- **React**: 19.2.3
- **Node.js**: >= 20.19.4

## Prerequisites

### All Platforms

- Node.js >= 20.19.4
- Bun package manager (installed via mise)

### iOS & macOS

- macOS computer (required for iOS/macOS development)
- Xcode 14.0 or later
- CocoaPods (`gem install cocoapods`)

### Android

- Android Studio
- Android SDK (API 24-35)
- Java Development Kit (JDK) 17

### Windows

- Windows 10 21H2 or Windows 11
- Visual Studio 2019 or 2022 with:
  - Desktop development with C++
  - Windows 10 SDK (10.0.19041.0 or later)

## Build Instructions

### Install Dependencies

```bash
cd packages/clauderon/mobile
bun install
```

### Android

```bash
# Run on connected device or emulator
bun run android

# Or use the React Native CLI directly
npx react-native run-android
```

**Requirements:**
- Android device with USB debugging enabled, or
- Android emulator running

**First-time setup:**
```bash
# Install Android dependencies
cd android
./gradlew clean
cd ..
```

### iOS

```bash
# Install CocoaPods dependencies
cd ios
pod install
cd ..

# Run on simulator
bun run ios

# Run on specific simulator
npx react-native run-ios --simulator="iPhone 15 Pro"

# Run on connected device (requires signing configuration)
npx react-native run-ios --device
```

**Requirements:**
- macOS computer
- Xcode installed
- iOS Simulator or connected iOS device

### iPad

iPad support is included automatically with the iOS build. The app is a universal binary that runs on both iPhone and iPad.

```bash
# Run on iPad simulator
npx react-native run-ios --simulator="iPad Pro (12.9-inch)"
```

### macOS

```bash
# Install CocoaPods dependencies
cd macos
pod install
cd ..

# Run on macOS
bun run macos

# Or use React Native CLI
npx react-native run-macos
```

**Requirements:**
- macOS computer
- Xcode installed

**First-time setup:**
After running `pod install`, you may need to open the workspace in Xcode and configure signing for the macOS target.

### Windows

```bash
# Run on Windows
bun run windows

# Or use React Native CLI
npx @react-native-community/cli run-windows
```

**Requirements:**
- Windows 10 21H2 or Windows 11
- Visual Studio 2019 or 2022
- Windows 10 SDK

**First-time setup:**
1. Open `windows/ClauderonMobile.sln` in Visual Studio
2. Configure build settings if needed
3. Build the solution

**Debug vs Release:**
```bash
# Debug build (default)
bun run windows

# Release build
npx @react-native-community/cli run-windows --release
```

## Platform-Specific Features & Limitations

### All Platforms

- WebSocket support for real-time console I/O
- Session management
- Message history
- Settings persistence

### Mobile Platforms (iOS & Android)

- Image upload from photo library
- Camera support for taking photos
- Push notifications (if configured)

### iPad

- Same features as iPhone
- Optimized layouts for larger screen
- Split-screen multitasking support

### macOS

- Image upload from file picker
- No camera support (use image library)
- Native macOS window controls
- Menu bar integration

### Windows

- ⚠️ **Image upload not yet supported**
  - react-native-image-picker doesn't support Windows
  - Shows informative error message when attempting to pick images
  - This is a known limitation of React Native Windows ecosystem
- Native Windows window controls
- Keyboard shortcuts work as expected

## Development Commands

```bash
# Start Metro bundler
bun run start

# Run TypeScript type checking
bun run typecheck

# Run linter
bun run lint

# Run tests
bun run test

# Run Windows-specific tests
bun run test:windows
```

## Troubleshooting

### iOS Build Errors

**Pod install fails:**
```bash
cd ios
rm -rf Pods Podfile.lock
pod repo update
pod install
cd ..
```

**Code signing errors:**
- Open `ios/ClauderonMobile.xcworkspace` in Xcode
- Select your development team under Signing & Capabilities

### Android Build Errors

**Gradle sync fails:**
```bash
cd android
./gradlew clean
cd ..
rm -rf node_modules
bun install
```

**Missing SDK:**
- Open Android Studio
- Go to SDK Manager and install required SDK versions (24-35)

### macOS Build Errors

**Pod install fails:**
```bash
cd macos
rm -rf Pods Podfile.lock
pod repo update
pod install
cd ..
```

**Signing errors:**
- Open `macos/clauderon-mobile.xcworkspace` in Xcode
- Configure signing for the macOS target

### Windows Build Errors

**Visual Studio not found:**
- Install Visual Studio 2019 or 2022
- Ensure "Desktop development with C++" workload is installed

**Windows SDK missing:**
- Open Visual Studio Installer
- Modify your installation
- Under Individual Components, install Windows 10 SDK (10.0.19041.0 or later)

**MSBuild errors:**
```bash
# Clean Windows build
cd windows
rm -rf */bin */obj .vs
cd ..
```

## Metro Bundler

The Metro bundler needs to be running for all platforms during development:

```bash
# Terminal 1: Start Metro
bun run start

# Terminal 2: Run platform-specific build
bun run android  # or ios, macos, windows
```

Press `r` in Metro to reload
Press `d` to open developer menu

## Architecture

### Cross-Platform Code

- All TypeScript/React code in `src/` is shared across platforms
- Platform-specific code uses `Platform.select()` or `Platform.OS` checks
- Custom platform abstractions in `src/lib/` (e.g., `imagePicker.ts`)

### Native Code

- **iOS**: Objective-C/Swift in `ios/`
- **Android**: Kotlin in `android/app/src/main/`
- **macOS**: Objective-C/Swift in `macos/`
- **Windows**: C++ in `windows/ClauderonMobile/`

### Styling

Platform-specific styles are defined in:
- `src/styles/typography.ts` - Font families per platform
- `src/styles/common.ts` - Shadow and elevation per platform
- Component StyleSheets use `Platform.select()` where needed

## Future Improvements

### Windows

- [ ] Implement native file picker for image uploads
- [ ] Add native module for Windows-specific features
- [ ] Improve performance optimization

### All Platforms

- [ ] Upgrade to React Native 0.83+ when desktop support is available
- [ ] Add automated tests for platform-specific code
- [ ] Implement platform-specific analytics

## Resources

- [React Native Documentation](https://reactnative.dev/)
- [React Native for Windows](https://microsoft.github.io/react-native-windows/)
- [React Native for macOS](https://microsoft.github.io/react-native-macos/)
- [Clauderon Documentation](../../README.md)
