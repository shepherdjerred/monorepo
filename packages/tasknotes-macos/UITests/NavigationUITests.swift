import TaskNotesKit
import XCTest

/// Journeys that need the real app, and an accessibility audit on each.
///
/// These are the flows that do **not** depend on system-level event posting, so
/// they run on an unprivileged machine. The two that do — anything involving the
/// global hotkey — live in ``QuickAddPanelUITests`` and are blocked on a one-time
/// Accessibility grant; see `AGENTS.md` › Running the end-to-end tests.
///
/// ⚠️ **These flows deliberately do not call `performAccessibilityAudit()`**,
/// and the reasoning is recorded in
/// `packages/docs/todos/macos-accessibility-audit.md`. The audit found real
/// problems and two of them are fixed; what it cannot do here is be a *gate*.
/// Its findings bottom out in two things this project cannot act on — SwiftUI's
/// own undescribed container scaffolding, and contrast on a window titlebar and
/// on a deliberately de-emphasised retired row. Excluding categories until the
/// remainder passes is the same move as narrowing an assertion until it holds,
/// which this project has refused twice. It stays a diagnostic that is run and
/// read, not a green light that means nothing.
final class NavigationUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// Launch the app pointed at nothing, and tear it down with the test.
    ///
    /// Goes through ``TestApp`` rather than `XCUIApplication().launch()` so the
    /// app cannot inherit the developer's real server address or Keychain
    /// token — see the note there; this suite once pulled a live vault.
    private func launchedApp() -> XCUIApplication {
        TestApp.launch { addTeardownBlock($0) }
    }

    /// Every sidebar section is reachable and swaps the detail pane.
    ///
    /// The assertion is on the **detail** identifier rather than on the row's
    /// selected state, because a selected row with a stale detail pane is the
    /// failure that actually matters and the one a screenshot would hide.
    func testEachSidebarSectionOpensItsOwnDetailPane() throws {
        let app = launchedApp()
        for section in SidebarSection.allCases {
            let row = app.staticTexts[AccessibilityIdentifier.sidebarItem(section)]
            XCTAssertTrue(
                row.waitForExistence(timeout: 10),
                "no sidebar row for \(section.rawValue)"
            )
            row.click()

            let detail = app.groups[AccessibilityIdentifier.detail(section)]
            XCTAssertTrue(
                detail.waitForExistence(timeout: 5),
                "selecting \(section.rawValue) did not open its detail pane: "
                    + app.debugDescription
            )
        }
    }

    /// `⌘F` reveals the search field, which is the plan's desktop idiom for what
    /// the phone made a pushed screen.
    ///
    /// Search being a toolbar field rather than a route is a decision the plan
    /// records; this is the assertion that it stayed one.
    func testCommandFRevealsTheSearchField() throws {
        let app = launchedApp()
        let search = app.searchFields[AccessibilityIdentifier.TaskList.search]
        app.typeKey("f", modifierFlags: [.command])

        XCTAssertTrue(
            search.waitForExistence(timeout: 5),
            "⌘F did not reveal the search field: \(app.debugDescription)"
        )
    }

    /// The board is reachable from the sidebar and renders.
    ///
    /// ⚠️ Deliberately **not** an enumeration of every status column. That exact
    /// assertion already exists as `KanbanBoardTests`' *"an empty vault still
    /// produces every column"*, which runs headlessly in milliseconds against
    /// the model. Restating it here would buy nothing and cost a full app launch
    /// per run — and the plan is explicit that this layer is capped at the
    /// journeys nothing cheaper can reach.
    ///
    /// What only this layer can show is that the destination is *reachable*: a
    /// board that renders perfectly but has no way in is a green model suite and
    /// a missing feature.
    func testTheBoardIsReachableFromTheSidebar() throws {
        let app = launchedApp()
        let board = app.staticTexts[
            AccessibilityIdentifier.sidebarItem(TaskNotesDestination.board)
        ]
        XCTAssertTrue(board.waitForExistence(timeout: 10), "no board row in the sidebar")
        board.click()

        let detail = app.groups[AccessibilityIdentifier.detail(TaskNotesDestination.board)]
        XCTAssertTrue(
            detail.waitForExistence(timeout: 5),
            "the board did not open: \(app.debugDescription)"
        )
    }
}
