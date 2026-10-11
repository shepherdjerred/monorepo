import XCTest

/// Run with ios:native:e2e: its disposable simulator contains a fresh fixture
/// vault and no user credentials. The launcher also verifies the resulting files.
@MainActor
final class StandaloneTaskTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        XCTAssertNotNil(
            environment["FACET_E2E_SIMULATOR"],
            "Run ios:native:e2e to create and seed a disposable simulator.")
        XCTAssertEqual(environment["FACET_E2E_SIMULATOR"], environment["SIMULATOR_UDID"])
        addUIInterruptionMonitor(withDescription: "Unexpected Facet error") { _ in
            XCTFail("The disposable local journey was interrupted. No alert was accepted.")
            return false
        }
    }

    func testCaptureEditCompleteAndRelaunchUseTheLocalVault() {
        let app = launch()
        let existing = taskButton("E2E existing task", in: app)
        XCTAssertTrue(existing.waitForExistence(timeout: 20), app.debugDescription)
        attach(app, named: "01 Seeded local vault")

        app.buttons["facet.capture.open"].tap()
        let capture = app.textFields["facet.capture.title"]
        XCTAssertTrue(capture.waitForExistence(timeout: 5), app.debugDescription)
        capture.tap()
        let capturedTitle = "E2E captured task"
        capture.typeText(capturedTitle)
        app.buttons["facet.capture.submit"].tap()

        let created = taskButton(capturedTitle, in: app)
        XCTAssertTrue(created.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(existing.exists)
        attach(app, named: "02 Task captured")
        created.tap()

        let editor = app.textFields["facet.editor.title"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5), app.debugDescription)
        editor.tap()
        editor.press(forDuration: 1.1)
        let selectAll = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", "Select All")
        ).firstMatch
        XCTAssertTrue(selectAll.waitForExistence(timeout: 5), app.debugDescription)
        selectAll.tap()
        editor.typeText("E2E edited task")
        XCTAssertEqual(editor.value as? String, "E2E edited task")
        app.buttons["facet.editor.save"].tap()
        let edited = taskButton("E2E edited task", in: app)
        XCTAssertTrue(edited.waitForExistence(timeout: 10), app.debugDescription)
        attach(app, named: "03 Task edited")

        app.terminate()
        app.launch()
        XCTAssertTrue(edited.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertTrue(existing.exists)
        attach(app, named: "04 Edit survives relaunch")

        app.buttons["Complete E2E edited task"].tap()
        XCTAssertTrue(edited.waitForNonExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(existing.exists)
        assertCompletedTask(in: app)
        attach(app, named: "05 Task completed")

        app.terminate()
        app.launch()
        XCTAssertTrue(existing.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertFalse(edited.exists)
        assertCompletedTask(in: app)
        attach(app, named: "06 Completion survives relaunch")
        app.terminate()
    }

    func testCaptureRemainsUsableAtAccessibilityTextSize() {
        let app = launch(accessibilitySize: true)
        XCTAssertTrue(taskButton("E2E existing task", in: app).waitForExistence(timeout: 20))
        let add = app.buttons["facet.capture.open"]
        XCTAssertTrue(add.isHittable)
        add.tap()
        let field = app.textFields["facet.capture.title"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(field.isHittable)
        field.tap()
        field.typeText("Accessibility draft")
        let submit = app.buttons["facet.capture.submit"]
        XCTAssertTrue(submit.isEnabled)
        XCTAssertTrue(submit.isHittable)
        attach(app, named: "07 Capture at accessibility text size")
        app.buttons["Cancel"].tap()
        app.buttons["Discard"].tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 5))
        XCTAssertFalse(taskButton("Accessibility draft", in: app).exists)
        app.terminate()
    }

    private func launch(accessibilitySize: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FACET_E2E_SIMULATOR"] =
            ProcessInfo.processInfo.environment[
                "FACET_E2E_SIMULATOR"]
        app.launchArguments = ["--facet-native-acceptance"]
        if accessibilitySize { app.launchArguments.append("--facet-accessibility-size") }
        app.launch()
        addTeardownBlock { @MainActor in app.terminate() }
        return app
    }

    private func taskButton(_ title: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", title)).firstMatch
    }

    private func assertCompletedTask(in app: XCUIApplication) {
        app.tabBars.buttons["Browse"].tap()
        app.buttons["Completed"].tap()
        XCTAssertTrue(taskButton("E2E edited task", in: app).waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Uncomplete E2E edited task"].exists)
    }

    private func attach(_ app: XCUIApplication, named name: String) {
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = name
        evidence.lifetime = .keepAlways
        add(evidence)
    }
}
