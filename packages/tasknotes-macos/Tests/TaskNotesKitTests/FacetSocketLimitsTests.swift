import Foundation
import TaskNotesUniFFI
import Testing

@testable import TaskNotesKit

struct FacetSocketLimitsTests {
    @Test func actualTwoMiBWebSocketPieceAndOversizeBoundary() async throws {
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent()
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = [
            "bun",
            repository.appendingPathComponent(
                "packages/tasknotes-macos/Tests/Support/socket-boundary.mjs"
            ).path,
        ]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        try process.run()
        defer {
            process.terminate()
            process.waitUntilExit()
        }
        let line = output.fileHandleForReading.availableData
        let text = try #require(String(bytes: line, encoding: .utf8))
        let port = try #require(Int(text.trimmingCharacters(in: .whitespacesAndNewlines)))
        let url = try #require(URL(string: "ws://127.0.0.1:\(port)"))
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let socket = session.webSocketTask(with: url)
        let limits = try obsidianTransportLimits()
        #expect(socket.maximumMessageSize < Int(limits.binaryMessageBytes))
        try FacetSocketLimits.configure(socket, limits: limits)
        socket.resume()
        defer { socket.cancel(with: .goingAway, reason: nil) }
        try await socket.send(.string("binary"))
        let message = try await socket.receive()
        try FacetSocketLimits.validate(message, limits: limits)
        if case .data(let bytes) = message {
            #expect(bytes.count == 2_097_152)
        } else {
            Issue.record("Expected an actual binary WebSocket message.")
        }
        try await socket.send(.string("oversized-binary"))
        let oversized = try await socket.receive()
        #expect(throws: FacetSyncError.self) {
            try FacetSocketLimits.validate(oversized, limits: limits)
        }
    }
}
