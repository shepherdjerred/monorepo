.PHONY: build run test test-unit test-all test-integration clean lint format dead-code install install-xcode coverage xcode

# Use Xcode toolchain for XCTest/Testing support
export DEVELOPER_DIR ?= /Applications/Xcode.app/Contents/Developer

build:
	cd GlanceApp && swift build

release:
	cd GlanceApp && swift build -c release

run:
	cd GlanceApp && swift run

test:
	cd GlanceApp && swift test

test-unit:
	cd GlanceApp && swift test --filter '!/integration/'

test-all:
	cd GlanceApp && GLANCE_INTEGRATION=1 swift test

test-integration:
	cd GlanceApp && GLANCE_INTEGRATION=1 swift test --filter integration

clean:
	cd GlanceApp && swift package clean
	xcodebuild -project Glance.xcodeproj -scheme GlanceApp clean 2>/dev/null || true

lint:
	cd GlanceApp && swiftlint --strict --config ../.swiftlint.yml Sources Tests
	cd GlanceWidget && swiftlint --strict --config ../.swiftlint.yml Sources

format:
	cd GlanceApp && swiftformat .
	swiftformat GlanceWidget

dead-code:
	cd GlanceApp && periphery scan --strict

coverage:
	cd GlanceApp && swift test --enable-code-coverage
	@echo "Coverage report:"
	@xcrun llvm-cov report $$(find GlanceApp/.build/debug -name "GlanceAppPackageTests" -type f | head -1) --instr-profile $$(find GlanceApp/.build/debug -name "default.profdata" | head -1) 2>/dev/null || echo "Run 'make coverage' to generate coverage data"

# Regenerate the Xcode project from project.yml (requires xcodegen)
xcode:
	xcodegen generate
	@echo "Open with: open Glance.xcodeproj"

APP_NAME = Glance
APP_BUNDLE = $(APP_NAME).app
BINARY = GlanceApp/.build/release/GlanceApp
CODESIGN_ID = Developer ID Application: JERRED ARTHUR SHEPHERD (63ZAG7X889)

# Install via SPM (no widget extension — use install-xcode for that)
install: release
	@-pkill -x "$(APP_NAME)" 2>/dev/null; true
	@echo "Creating $(APP_BUNDLE)..."
	@rm -rf "$(APP_BUNDLE)"
	@mkdir -p "$(APP_BUNDLE)/Contents/MacOS"
	@mkdir -p "$(APP_BUNDLE)/Contents/Resources"
	@cp "$(BINARY)" "$(APP_BUNDLE)/Contents/MacOS/$(APP_NAME)"
	@cp GlanceApp/Resources/AppIcon.icns "$(APP_BUNDLE)/Contents/Resources/AppIcon.icns"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string $(APP_NAME)" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.shepherdjerred.glance" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleName string $(APP_NAME)" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundlePackageType string APPL" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleVersion string 1.0" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AppIcon" "$(APP_BUNDLE)/Contents/Info.plist"
	@codesign --force --sign "$(CODESIGN_ID)" --deep "$(APP_BUNDLE)"
	@echo "Installing to /Applications..."
	@rm -rf "/Applications/$(APP_BUNDLE)"
	@cp -r "$(APP_BUNDLE)" "/Applications/$(APP_BUNDLE)"
	@rm -rf "$(APP_BUNDLE)"
	@echo "Installed /Applications/$(APP_BUNDLE)"
	@open "/Applications/$(APP_BUNDLE)"

# Install via Xcode (includes widget extension for Notification Center)
install-xcode: xcode
	@-pkill -x "$(APP_NAME)" 2>/dev/null; true
	xcodebuild -project Glance.xcodeproj -scheme GlanceApp -configuration Release build -allowProvisioningUpdates
	@rm -rf "/Applications/$(APP_BUNDLE)"
	@cp -R $$(xcodebuild -project Glance.xcodeproj -scheme GlanceApp -configuration Release -showBuildSettings 2>/dev/null | grep ' BUILT_PRODUCTS_DIR' | awk '{print $$3}')/$(APP_BUNDLE) "/Applications/$(APP_BUNDLE)"
	@echo "Installed /Applications/$(APP_BUNDLE) (with widget)"
	@open "/Applications/$(APP_BUNDLE)"
