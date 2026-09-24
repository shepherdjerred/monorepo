// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Hello",
  platforms: [.macOS(.v15)],
  targets: [.executableTarget(name: "Hello")]
)
