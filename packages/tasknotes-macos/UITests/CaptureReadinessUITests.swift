import XCTest

/// Provisions capture readiness independently of recurrence acceptance.
@MainActor
final class CaptureReadinessUITests: XCTestCase {
    func testOwnedSyntheticWindowCapture() async throws {
        continueAfterFailure = false
        let context = try OccurrenceVaultContext(test: self)
        let window = try context.launch()
        try await MacAcceptanceCapture.attach(
            app: context.app, name: "Capture readiness — owned synthetic workspace",
            test: self, windows: [window])
        try context.terminate()
    }
}
