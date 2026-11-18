import TaskNotesKit
import XCTest

@MainActor
final class FacetMobileUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testLaunchesIntoTodayWorkspaceInIsolatedMode() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-\(UITesting.serverAddressDefaultsKey)", "http://127.0.0.1:1",
            "-\(UITesting.storageFolderDefaultsKey)", "Facet-iOS-UITests-\(UUID().uuidString)",
            UITesting.flagArgument,
        ]
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
    }
}
