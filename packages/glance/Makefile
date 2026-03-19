.PHONY: build run test test-unit test-all test-integration clean lint format dead-code install coverage

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

lint:
	cd GlanceApp && swiftlint --strict --config ../.swiftlint.yml Sources Tests

format:
	cd GlanceApp && swiftformat .

dead-code:
	cd GlanceApp && periphery scan --strict

coverage:
	cd GlanceApp && swift test --enable-code-coverage
	@echo "Coverage report:"
	@xcrun llvm-cov report $$(find GlanceApp/.build/debug -name "GlanceAppPackageTests" -type f | head -1) --instr-profile $$(find GlanceApp/.build/debug -name "default.profdata" | head -1) 2>/dev/null || echo "Run 'make coverage' to generate coverage data"

APP_NAME = Glance
APP_BUNDLE = $(APP_NAME).app
BINARY = GlanceApp/.build/release/GlanceApp

install: release
	@-pkill -x "$(APP_NAME)" 2>/dev/null; true
	@echo "Creating $(APP_BUNDLE)..."
	@rm -rf "$(APP_BUNDLE)"
	@mkdir -p "$(APP_BUNDLE)/Contents/MacOS"
	@cp "$(BINARY)" "$(APP_BUNDLE)/Contents/MacOS/$(APP_NAME)"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string $(APP_NAME)" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.shepherdjerred.glance" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleName string $(APP_NAME)" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundlePackageType string APPL" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :CFBundleVersion string 1.0" "$(APP_BUNDLE)/Contents/Info.plist"
	@/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$(APP_BUNDLE)/Contents/Info.plist"
	@codesign --force --sign "Developer ID Application: JERRED ARTHUR SHEPHERD (63ZAG7X889)" --deep "$(APP_BUNDLE)"
	@echo "Installing to /Applications..."
	@rm -rf "/Applications/$(APP_BUNDLE)"
	@cp -r "$(APP_BUNDLE)" "/Applications/$(APP_BUNDLE)"
	@rm -rf "$(APP_BUNDLE)"
	@echo "Installed /Applications/$(APP_BUNDLE)"
	@open "/Applications/$(APP_BUNDLE)"
