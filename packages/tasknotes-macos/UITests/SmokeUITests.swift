import TaskNotesKit
import XCTest

/// The smallest possible proof that the UI-test harness itself works.
///
/// Written and run before any real flow, deliberately: the interesting question
/// at this point is not whether the app behaves, it is whether an XCUITest
/// target can launch a **sandboxed, ad-hoc-signed** app at all, and whether the
/// identifiers in `TaskNotesKit` are visible from here. Both have to be true
/// before a single flow is worth writing.
final class SmokeUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testTheAppLaunchesAndShowsItsSidebar() throws {
        let app = TestApp.launch { addTeardownBlock($0) }

        // Looked up by the identifier the app itself uses. If someone renames
        // `AccessibilityIdentifier.sidebar`, this file stops compiling — which
        // is the entire reason the UI test target links `TaskNotesKit`.
        let sidebar = app.outlines[AccessibilityIdentifier.sidebar]
        let table = app.tables[AccessibilityIdentifier.sidebar]
        let found =
            sidebar.waitForExistence(timeout: 20) || table.waitForExistence(timeout: 1)
        XCTAssertTrue(found, "the source list never appeared: \(app.debugDescription)")
    }
}
