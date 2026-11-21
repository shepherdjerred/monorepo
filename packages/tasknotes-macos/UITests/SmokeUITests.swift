import TaskNotesKit
import XCTest

/// The smallest possible proof that the UI-test harness itself works.
///
/// Written and run before any real flow, deliberately: the interesting question
/// at this point is not whether the app behaves, it is whether an XCUITest
/// target can launch a **sandboxed, ad-hoc-signed** app at all, and whether the
/// identifiers in `TaskNotesKit` are visible from here. Both have to be true
/// before a single flow is worth writing.
@MainActor
final class SmokeUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testFindsAnUndatedInboxTaskFromToday() throws {
        let app = TestApp.launch { addTeardownBlock($0) }
        let inbox = app.buttons[AccessibilityIdentifier.sidebarSection(.inbox)]
        XCTAssertTrue(inbox.waitForExistence(timeout: 10))
        inbox.click()
        app.typeKey("n", modifierFlags: .command)
        let field = app.textFields[AccessibilityIdentifier.QuickAdd.field]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("Pick up groceries\n")
        app.buttons[AccessibilityIdentifier.sidebarSection(.today)].click()
        app.typeKey("f", modifierFlags: .command)
        let query = app.textFields["facet.workspaceSearch.query"]
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        query.typeText("groceries")
        let result = app.buttons.matching(NSPredicate(format: "label == %@", "Pick up groceries"))
            .firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        app.typeKey(.return, modifierFlags: [])
        let inspectorTitle = app.textFields[AccessibilityIdentifier.Inspector.title]
        XCTAssertTrue(inspectorTitle.waitForExistence(timeout: 5))
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        XCTAssertEqual(query.value as? String, "groceries")
        // Space activates a focused native button. Typing it into the query would leave the
        // search list visible, so reopening the inspector also proves result focus was restored.
        app.typeKey(.space, modifierFlags: [])
        XCTAssertTrue(inspectorTitle.waitForExistence(timeout: 5))
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(query.waitForNonExistence(timeout: 5))
    }

    func testKeyboardNavigationInPersonalWorkspace() throws {
        let app = TestApp.launch(additionalArguments: ["--facet-personal-workspace-fixture"]) {
            addTeardownBlock($0)
        }
        let bicycle = app.buttons.matching(
            NSPredicate(
                format: "label BEGINSWITH %@", "Pick up repaired bicycle")
        ).firstMatch
        XCTAssertTrue(bicycle.waitForExistence(timeout: 10))
        bicycle.click()
        let inspectorTitle = app.textFields[AccessibilityIdentifier.Inspector.title]
        XCTAssertTrue(inspectorTitle.waitForExistence(timeout: 5))
        XCTAssertEqual(inspectorTitle.value as? String, "Pick up repaired bicycle")
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(inspectorTitle.waitForNonExistence(timeout: 5))
        app.typeKey(.downArrow, modifierFlags: [])
        app.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(inspectorTitle.waitForExistence(timeout: 5))
        XCTAssertNotEqual(inspectorTitle.value as? String, "Pick up repaired bicycle")
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(inspectorTitle.waitForNonExistence(timeout: 5))
        app.typeKey(.upArrow, modifierFlags: [])
        app.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(inspectorTitle.waitForExistence(timeout: 5))
        XCTAssertEqual(inspectorTitle.value as? String, "Pick up repaired bicycle")
        let detail = XCTAttachment(screenshot: app.screenshot())
        detail.name = "Personal workspace task detail"
        detail.lifetime = .keepAlways
        add(detail)
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(inspectorTitle.waitForNonExistence(timeout: 5))
        app.typeKey("q", modifierFlags: [])
        let field = app.textFields[AccessibilityIdentifier.QuickAdd.field]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("quartz")
        XCTAssertEqual(field.value as? String, "quartz")
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
