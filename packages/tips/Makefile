.PHONY: build run test clean lint format

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
	cd TipsApp && swiftlint --strict

format:
	cd TipsApp && swiftformat .
