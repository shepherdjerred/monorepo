import XCTest

/// Ordered by ios-local-mutation-acceptance.ts, with stopped-app Markdown checks.
@MainActor
final class LocalMutationTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        XCTAssertNotNil(environment["FACET_E2E_SIMULATOR"])
        XCTAssertEqual(environment["FACET_E2E_SIMULATOR"], environment["SIMULATOR_UDID"])
        addUIInterruptionMonitor(withDescription: "Unexpected local mutation interruption") { _ in
            XCTFail("The synthetic mutation journey was interrupted. No alert was accepted.")
            return false
        }
    }

    func testUncompleteReturnsThePersistedTaskToInbox() {
        let app = launch()
        app.tabBars.buttons["Browse"].tap()
        app.buttons["Completed"].tap()
        XCTAssertTrue(task(in: app).waitForExistence(timeout: 10), app.debugDescription)
        let reopen = app.buttons["Uncomplete E2E edited task"]
        XCTAssertTrue(reopen.isHittable, app.debugDescription)
        reopen.tap()
        XCTAssertTrue(task(in: app).waitForNonExistence(timeout: 10), app.debugDescription)
        app.tabBars.buttons["Inbox"].tap()
        XCTAssertTrue(task(in: app).waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.buttons["Complete E2E edited task"].exists)
        attach(app, "01 Uncomplete returns the task to Inbox")
        app.terminate()
    }

    func testDeleteUndoRestoresTheReopenedTask() {
        let app = launch()
        XCTAssertTrue(task(in: app).waitForExistence(timeout: 20), app.debugDescription)
        task(in: app).tap()
        let title = app.textFields["facet.editor.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5), app.debugDescription)
        let delete = app.buttons["Delete task"]
        for _ in 0..<8 where !delete.isHittable { app.swipeUp() }
        XCTAssertTrue(delete.isHittable, app.debugDescription)
        delete.tap()
        let confirmation = app.buttons["Delete"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5), app.debugDescription)
        confirmation.tap()
        XCTAssertTrue(title.waitForNonExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(task(in: app).waitForNonExistence(timeout: 10), app.debugDescription)
        let undo = app.buttons.matching(NSPredicate(format: "label == %@", "Undo")).firstMatch
        XCTAssertTrue(undo.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(undo.isHittable, app.debugDescription)
        attach(app, "02 Deletion removes the task and offers Undo")
        undo.tap()
        XCTAssertTrue(task(in: app).waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.buttons["Complete E2E edited task"].exists)
        attach(app, "03 Undo restores the reopened task")
        app.terminate()
    }

    func testRestorationSurvivesColdLaunchAndCanCompleteAgain() {
        let app = launch()
        XCTAssertTrue(task(in: app).waitForExistence(timeout: 20), app.debugDescription)
        attach(app, "04 Undo restoration survives cold launch")
        app.buttons["Complete E2E edited task"].tap()
        XCTAssertTrue(task(in: app).waitForNonExistence(timeout: 10), app.debugDescription)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Browse"].waitForExistence(timeout: 20))
        app.tabBars.buttons["Browse"].tap()
        app.buttons["Completed"].tap()
        XCTAssertTrue(task(in: app).waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.buttons["Uncomplete E2E edited task"].exists)
        attach(app, "05 Recompletion survives cold launch")
        app.terminate()
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FACET_E2E_SIMULATOR"] =
            ProcessInfo.processInfo.environment["FACET_E2E_SIMULATOR"]
        app.launchArguments = ["--facet-native-acceptance"]
        app.launch()
        addTeardownBlock { @MainActor in app.terminate() }
        XCTAssertTrue(app.tabBars.buttons["Inbox"].waitForExistence(timeout: 20))
        return app
    }

    private func task(in app: XCUIApplication) -> XCUIElement {
        app.buttons.containing(.staticText, identifier: "E2E edited task").firstMatch
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }
}
