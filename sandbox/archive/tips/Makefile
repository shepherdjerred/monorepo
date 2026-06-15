.PHONY: build run test clean lint format install install-xcode notarize icon xcode

# Use Xcode toolchain for XCTest/Testing support
export DEVELOPER_DIR ?= /Applications/Xcode.app/Contents/Developer

build:
	cd QuickTipApp && swift build

release:
	cd QuickTipApp && swift build -c release

run:
	cd QuickTipApp && swift run

test:
	cd QuickTipApp && swift test

clean:
	cd QuickTipApp && swift package clean
	xcodebuild -project QuickTip.xcodeproj -scheme QuickTipApp clean 2>/dev/null || true

lint:
	cd QuickTipApp && swiftlint --strict --config ../.swiftlint.yml Sources Tests

format:
	cd QuickTipApp && swiftformat .

# Regenerate the Xcode project from project.yml (requires xcodegen)
xcode:
	xcodegen generate
	@echo "Open with: open QuickTip.xcodeproj"

APP_NAME = QuickTip
APP_BUNDLE = $(APP_NAME).app
BINARY = QuickTipApp/.build/release/QuickTipApp
RESOURCES = QuickTipApp/.build/release/QuickTipApp_QuickTipApp.bundle
ICON_SCRIPT = QuickTipApp/scripts/generate-icon.swift
CODESIGN_ID = Developer ID Application: JERRED ARTHUR SHEPHERD (63ZAG7X889)

# Install via SPM
install: release
	@-pkill -x "$(APP_NAME)" 2>/dev/null; true
	@echo "Creating $(APP_BUNDLE)..."
	@rm -rf "$(APP_BUNDLE)"
	@mkdir -p "$(APP_BUNDLE)/Contents/MacOS"
	@mkdir -p "$(APP_BUNDLE)/Contents/Resources"
	@cp "$(BINARY)" "$(APP_BUNDLE)/Contents/MacOS/$(APP_NAME)"
	@cp -R "$(RESOURCES)" "$(APP_BUNDLE)/Contents/Resources/" 2>/dev/null || true
	@cp QuickTipApp/Resources/AppIcon.icns "$(APP_BUNDLE)/Contents/Resources/AppIcon.icns" 2>/dev/null || true
	@/usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string $(APP_NAME)" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.jerred.QuickTipApp" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleName string $(APP_NAME)" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string $(APP_NAME)" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundlePackageType string APPL" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleVersion string 1" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 1.0.0" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :LSMinimumSystemVersion string 15.0" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :NSHumanReadableCopyright string Copyright © 2026 Jerred Shepherd. All rights reserved." "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AppIcon" "$(APP_BUNDLE)/Contents/Info.plist"
	@codesign --force --sign "$(CODESIGN_ID)" --options runtime --deep "$(APP_BUNDLE)"
	@echo "Installing to /Applications..."
	@rm -rf "/Applications/$(APP_BUNDLE)"
	@cp -r "$(APP_BUNDLE)" "/Applications/$(APP_BUNDLE)"
	@rm -rf "$(APP_BUNDLE)"
	@echo "Installed /Applications/$(APP_BUNDLE)"
	@open "/Applications/$(APP_BUNDLE)"

# Install via Xcode
install-xcode: xcode
	@-pkill -x "$(APP_NAME)" 2>/dev/null; true
	xcodebuild -project QuickTip.xcodeproj -scheme QuickTipApp -configuration Release build -allowProvisioningUpdates
	@rm -rf "/Applications/$(APP_BUNDLE)"
	@cp -R $$(xcodebuild -project QuickTip.xcodeproj -scheme QuickTipApp -configuration Release -showBuildSettings 2>/dev/null | grep ' BUILT_PRODUCTS_DIR' | awk '{print $$3}')/$(APP_BUNDLE) "/Applications/$(APP_BUNDLE)"
	@echo "Installed /Applications/$(APP_BUNDLE) (via Xcode)"
	@open "/Applications/$(APP_BUNDLE)"

notarize: install
	@echo "Submitting for notarization..."
	@ditto -c -k --keepParent "/Applications/$(APP_BUNDLE)" /tmp/QuickTip-notarize.zip
	@xcrun notarytool submit /tmp/QuickTip-notarize.zip --keychain-profile "notarytool" --wait
	@xcrun stapler staple "/Applications/$(APP_BUNDLE)"
	@echo "Notarization complete"
	@rm -f /tmp/QuickTip-notarize.zip

icon:
	@echo "Generating app icon..."
	@swift "$(ICON_SCRIPT)"
	@echo "Icon generated"
