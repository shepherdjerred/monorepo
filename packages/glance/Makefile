.PHONY: build run test clean lint format dead-code

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

clean:
	cd GlanceApp && swift package clean

lint:
	cd GlanceApp && swiftlint --strict

format:
	cd GlanceApp && swiftformat .

dead-code:
	cd GlanceApp && periphery scan --strict
