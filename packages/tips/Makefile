.PHONY: build run test clean lint format install notarize

# Use Xcode toolchain for XCTest/Testing support
export DEVELOPER_DIR ?= /Applications/Xcode.app/Contents/Developer

build:
	cd TipsApp && swift build

release:
	cd TipsApp && swift build -c release

run:
	cd TipsApp && swift run

test:
	cd TipsApp && swift test

clean:
	cd TipsApp && swift package clean

lint:
	cd TipsApp && swiftlint --strict --config ../.swiftlint.yml Sources Tests

format:
	cd TipsApp && swiftformat .

APP_NAME = Tips
APP_BUNDLE = $(APP_NAME).app
BINARY = TipsApp/.build/release/TipsApp
RESOURCES = TipsApp/.build/release/TipsApp_TipsApp.bundle
ICON_SCRIPT = TipsApp/scripts/generate-icon.swift

install: release
	@-pkill -x "$(APP_NAME)" 2>/dev/null; true
	@echo "Creating $(APP_BUNDLE)..."
	@rm -rf "$(APP_BUNDLE)"
	@mkdir -p "$(APP_BUNDLE)/Contents/MacOS"
	@mkdir -p "$(APP_BUNDLE)/Contents/Resources"
	@cp "$(BINARY)" "$(APP_BUNDLE)/Contents/MacOS/$(APP_NAME)"
	@cp -R "$(RESOURCES)" "$(APP_BUNDLE)/Contents/Resources/" 2>/dev/null || true
	@cp TipsApp/Resources/AppIcon.icns "$(APP_BUNDLE)/Contents/Resources/AppIcon.icns" 2>/dev/null || true
	@/usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string $(APP_NAME)" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.jerred.TipsApp" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleName string $(APP_NAME)" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string $(APP_NAME)" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundlePackageType string APPL" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleVersion string 1" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 1.0.0" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :LSMinimumSystemVersion string 15.0" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :NSHumanReadableCopyright string Copyright © 2026 Jerred Shepherd. All rights reserved." "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AppIcon" "$(APP_BUNDLE)/Contents/Info.plist"
	@codesign --force --sign "Developer ID Application: JERRED ARTHUR SHEPHERD (63ZAG7X889)" --options runtime --deep "$(APP_BUNDLE)"
	@echo "Installing to /Applications..."
	@rm -rf "/Applications/$(APP_BUNDLE)"
	@cp -r "$(APP_BUNDLE)" "/Applications/$(APP_BUNDLE)"
	@rm -rf "$(APP_BUNDLE)"
	@echo "Installed /Applications/$(APP_BUNDLE)"
	@open "/Applications/$(APP_BUNDLE)"

notarize: install
	@echo "Submitting for notarization..."
	@ditto -c -k --keepParent "/Applications/$(APP_BUNDLE)" /tmp/Tips-notarize.zip
	@xcrun notarytool submit /tmp/Tips-notarize.zip --keychain-profile "notarytool" --wait
	@xcrun stapler staple "/Applications/$(APP_BUNDLE)"
	@echo "Notarization complete"
	@rm -f /tmp/Tips-notarize.zip

icon:
	@echo "Generating app icon..."
	@swift "$(ICON_SCRIPT)"
	@echo "Icon generated"
