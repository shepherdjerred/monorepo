import TaskNotesKit
import XCTest

@MainActor
final class FacetMobileUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func launch(additionalArguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments =
            [
                "-\(UITesting.serverAddressDefaultsKey)", "http://127.0.0.1:1",
                "-\(UITesting.storageFolderDefaultsKey)", "Facet-iOS-UITests-\(UUID().uuidString)",
                UITesting.flagArgument,
            ] + additionalArguments
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        return app
    }

    func screenshot(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testRepeatCaptureAndSearch() {
        let app = launch()
        let tabs = app.tabBars.firstMatch
        XCTAssertEqual(
            tabs.buttons.allElementsBoundByIndex.map(\.label),
            ["Inbox", "Today", "Upcoming", "Browse"])
        app.buttons[AccessibilityIdentifier.TaskList.newTask].tap()
        let field = app.textFields[AccessibilityIdentifier.QuickAdd.field]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        if app.buttons["Continue"].exists { app.buttons["Continue"].tap() }
        field.typeText("Book studio tomorrow p1")
        screenshot("Quick Add with recognized tokens", app)
        app.buttons["facet.quickAdd.editTokens"].tap()
        app.buttons["Keep “tomorrow” in title"].tap()
        app.buttons["Add Task"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 4))
        field.typeText("Pack sketchbook")
        XCTAssertEqual(field.value as? String, "Pack sketchbook")
        app.buttons["Add Task"].tap()
        app.buttons["facet.quickAdd.close"].tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 4))
        XCTAssertTrue(
            app.buttons.containing(
                NSPredicate(format: "label BEGINSWITH %@", "Book studio tomorrow")
            )
            .firstMatch.waitForExistence(timeout: 5))
        if app.buttons["Dismiss notice"].exists { app.buttons["Dismiss notice"].tap() }
        screenshot("Today with captured tasks", app)
        app.buttons["Search"].tap()
        let search = app.textFields["facet.workspaceSearch.query"]
        search.typeText("sketchbook")
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Pack sketchbook")).firstMatch
            .tap()
        XCTAssertTrue(
            app.descendants(matching: .any)[AccessibilityIdentifier.Inspector.title].firstMatch
                .waitForExistence(timeout: 5))
        screenshot("Task details", app)
    }

    func testUpcomingCaptureAndReschedule() {
        let app = launch()
        app.tabBars.buttons["Upcoming"].tap()
        app.buttons["Next week"].tap()
        app.buttons["Return to today"].tap()
        XCTAssertTrue(app.buttons[ViewerCalendar().today].isSelected)
        app.buttons["Next week"].tap()
        app.buttons[AccessibilityIdentifier.TaskList.newTask].tap()
        let field = app.textFields[AccessibilityIdentifier.QuickAdd.field]
        field.typeText("Review route")
        app.buttons["Add Task"].tap()
        app.buttons["facet.quickAdd.close"].tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 4))
        let row = app.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", "Review route"))
            .firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        if app.buttons["Dismiss notice"].exists { app.buttons["Dismiss notice"].tap() }
        screenshot("Upcoming with selected date", app)
        row.swipeLeft()
        if app.buttons["Schedule"].exists { app.buttons["Schedule"].tap() }
        app.buttons[AccessibilityIdentifier.Schedule.shortcut("today")].tap()
        app.tabBars.buttons["Today"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.swipeRight()
        if app.buttons["Complete"].exists { app.buttons["Complete"].tap() }
        XCTAssertTrue(row.waitForNonExistence(timeout: 4))
        app.buttons["Undo"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        app.tabBars.buttons["Browse"].tap()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 5))
        screenshot("Browse", app)
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].exists || app.staticTexts["Appearance"].exists)
    }

    func testCompleteTwoRowsAndUndoTheLastOne() {
        let app = launch()
        app.buttons[AccessibilityIdentifier.TaskList.newTask].tap()
        let field = app.textFields[AccessibilityIdentifier.QuickAdd.field]
        for title in ["Buy oranges", "Pack lunch"] {
            field.typeText(title)
            app.buttons["Add Task"].tap()
        }
        app.buttons["facet.quickAdd.close"].tap()
        let oranges = app.buttons["Complete Buy oranges"]
        let lunch = app.buttons["Complete Pack lunch"]
        XCTAssertTrue(oranges.waitForExistence(timeout: 5))
        oranges.tap()
        lunch.tap()
        XCTAssertTrue(lunch.waitForNonExistence(timeout: 3))
        XCTAssertFalse(oranges.exists)
        app.buttons["Undo"].tap()
        XCTAssertTrue(lunch.waitForExistence(timeout: 3))
        XCTAssertFalse(oranges.exists)
    }

    func testDragQuickAddOntoDate() throws {
        let app = launch()
        app.tabBars.buttons["Upcoming"].tap()
        let day = ViewerCalendar().addingDays(3)
        let target = app.buttons[day]
        let quickAdd = app.buttons[AccessibilityIdentifier.TaskList.newTask]
        XCTAssertTrue(target.waitForExistence(timeout: 5))
        quickAdd.press(forDuration: 0.6, thenDragTo: target)
        let field = app.textFields[AccessibilityIdentifier.QuickAdd.field]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("Pick up prints")
        app.buttons["Add Task"].tap()
        app.buttons["facet.quickAdd.close"].tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 4))
        XCTAssertTrue(target.isSelected)
        XCTAssertTrue(app.buttons["Pick up prints"].exists)
    }

    func testCaptureInProjectSection() {
        let app = launch()
        app.tabBars.buttons["Browse"].tap()
        app.buttons["Add project"].tap()
        app.textFields["Project name"].tap()
        app.textFields["Project name"].typeText("Printmaking")
        app.buttons["Create"].tap()
        app.buttons["Add Section"].tap()
        app.textFields["Section name"].tap()
        app.textFields["Section name"].typeText("Materials")
        app.buttons["Add"].tap()
        let section = app.descendants(matching: .any)[
            AccessibilityIdentifier.TaskList.group("Materials")
        ].firstMatch
        XCTAssertTrue(section.waitForExistence(timeout: 5))
        section.buttons["Add task"].tap()
        let field = app.textFields[AccessibilityIdentifier.QuickAdd.field]
        field.typeText("Order paper")
        app.buttons["Add Task"].tap()
        app.buttons["facet.quickAdd.close"].tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 4))
        XCTAssertTrue(app.buttons["Order paper"].waitForExistence(timeout: 5))
        screenshot("Project with section task", app)
    }
}

extension FacetMobileUITests {
    func testEditNotesAndAttachLabelFromTaskDetail() {
        let app = launch()
        app.buttons[AccessibilityIdentifier.TaskList.newTask].tap()
        let field = app.textFields[AccessibilityIdentifier.QuickAdd.field]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        if app.buttons["Continue"].exists { app.buttons["Continue"].tap() }
        field.typeText("Plan weekend walk")
        app.buttons["Add Task"].tap()
        app.buttons["facet.quickAdd.close"].tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 5))

        let row = app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Plan weekend walk")
        )
        .firstMatch
        row.tap()
        let edit = app.buttons[AccessibilityIdentifier.Inspector.detailsMode]
        edit.tap()
        let notes = app.textViews[AccessibilityIdentifier.Inspector.detailsSource]
        notes.typeText("Check trail map")
        edit.tap()
        let labels = app.buttons[AccessibilityIdentifier.Inspector.labels]
        labels.tap()
        let label = app.textFields["New label"]
        label.tap()
        label.typeText("Outdoors")
        app.buttons["Add"].tap()
        app.navigationBars["Labels"].buttons["Done"].tap()
        XCTAssertTrue(labels.waitForExistence(timeout: 5))
        XCTAssertEqual(labels.label, "Outdoors")
        app.navigationBars["Task"].buttons["Done"].tap()
        row.tap()
        XCTAssertTrue(app.staticTexts["Check trail map"].waitForExistence(timeout: 5))
        XCTAssertEqual(labels.label, "Outdoors")
        screenshot("Task detail with notes and label", app)
    }
}
