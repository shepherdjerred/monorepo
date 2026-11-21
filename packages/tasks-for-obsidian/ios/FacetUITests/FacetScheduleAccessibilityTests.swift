import TaskNotesKit
import XCTest

extension FacetMobileUITests {
    func testScheduleAtLargestTextSize() throws {
        let app = launch(additionalArguments: [
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ])
        app.buttons[AccessibilityIdentifier.TaskList.newTask].tap()
        let field = app.textFields[AccessibilityIdentifier.QuickAdd.field]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("Library")
        app.buttons["Add Task"].tap()
        app.buttons["facet.quickAdd.close"].tap()
        let row = app.buttons["Library"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        if app.buttons["Dismiss notice"].exists { app.buttons["Dismiss notice"].tap() }
        row.swipeLeft()
        if app.buttons["Schedule"].exists { app.buttons["Schedule"].tap() }

        let today = app.buttons[AccessibilityIdentifier.Schedule.shortcut("today")]
        XCTAssertTrue(today.waitForExistence(timeout: 5))
        screenshot("Schedule at largest text size", app)
        for shortcut in ["today", "tomorrow", "nextWeek"] {
            let button = app.buttons[AccessibilityIdentifier.Schedule.shortcut(shortcut)]
            XCTAssertTrue(button.isHittable, shortcut)
            XCTAssertTrue(app.frame.contains(button.frame), shortcut)
        }
        let apply = app.buttons["Apply"]
        XCTAssertTrue(apply.isHittable)
        XCTAssertTrue(app.frame.contains(apply.frame))
        XCTAssertTrue(app.buttons["No Date"].isHittable)
        apply.tap()
        XCTAssertTrue(today.waitForNonExistence(timeout: 5))
        XCTAssertTrue(row.isHittable)
        row.tap()
        app.buttons[AccessibilityIdentifier.Inspector.due].tap()
        XCTAssertTrue(today.waitForExistence(timeout: 5))
        screenshot("Schedule from task details at largest text size", app)
        continueAfterFailure = true
        try app.performAccessibilityAudit()
        today.tap()
        XCTAssertTrue(today.waitForNonExistence(timeout: 5))
    }
}
