import TaskNotesKit
import XCTest

extension FacetMobileUITests {
    func testTodayWorkspaceAccessibilityAudit() throws {
        let app = launch()
        capture("Return library books", in: app)
        continueAfterFailure = true
        try app.performAccessibilityAudit()
    }

    func testOfflineCaptureSurvivesRelaunch() {
        let app = launch()
        let title = "Return library books"
        capture(title, in: app)
        app.terminate()
        app.launch()
        let task = app.buttons[title]
        XCTAssertTrue(task.waitForExistence(timeout: 8))
        XCTAssertEqual(app.buttons.matching(identifier: title).count, 1)
        task.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)[AccessibilityIdentifier.Inspector.title].firstMatch
                .exists)
        screenshot("Offline task after relaunch", app)
    }

    func testAccessibilityTextSizeAndVoiceOverDescriptions() throws {
        let app = launch(additionalArguments: [
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ])
        let title = "Collect bike from the repair shop"
        capture(title, in: app, captureScreenshot: "Quick Add at largest accessibility text size")
        screenshot("Today at largest accessibility text size", app)
        try app.performAccessibilityAudit(for: [
            .sufficientElementDescription, .trait, .textClipped,
        ])
        app.buttons[title].tap()
        XCTAssertTrue(
            app.descendants(matching: .any)[AccessibilityIdentifier.Inspector.title].firstMatch
                .waitForExistence(timeout: 5))
        screenshot("Task details at largest accessibility text size", app)
        XCTAssertGreaterThanOrEqual(app.buttons["Complete task"].frame.minX, app.frame.minX)
        XCTAssertLessThanOrEqual(app.buttons["More actions"].frame.maxX, app.frame.maxX)
        let due = app.buttons[AccessibilityIdentifier.Inspector.due]
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.8))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.2))
        start.press(forDuration: 0, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
        screenshot("Task properties at largest accessibility text size", app)
        XCTAssertTrue(due.isHittable)
        XCTAssertLessThan(due.frame.maxY, app.frame.maxY - 40)
        app.navigationBars.buttons["Done"].tap()
        app.tabBars.buttons["Upcoming"].tap()
        screenshot("Upcoming at largest accessibility text size", app)
        XCTAssertGreaterThanOrEqual(app.buttons[ViewerCalendar().today].frame.width, 65)
        XCTAssertTrue(app.buttons["Next week"].isHittable)
        try app.performAccessibilityAudit(for: [
            .sufficientElementDescription, .trait, .textClipped,
        ])
    }

    func testVoiceOverReadsTaskAndCompletionAction() throws {
        let app = launch()
        let title = "Pick up drawings"
        capture(title, in: app)
        guard #available(iOS 27.0, *) else {
            XCTAssertTrue(app.buttons["Complete " + title].exists)
            try app.performAccessibilityAudit(for: [.sufficientElementDescription, .trait])
            return
        }
        let service = XCUIDevice.shared.voiceOverService
        let initiallyEnabled = service.isEnabled
        try service.enable()
        addTeardownBlock { @MainActor in
            if !initiallyEnabled { try service.disable() }
        }
        XCTAssertTrue(service.isEnabled)
        var spoken: [String] = []
        for _ in 0..<32 {
            let phrase = try service.moveForward().utterance
            spoken.append(phrase)
            if spoken.contains(where: { $0.contains("Complete " + title) }),
                spoken.contains(where: { $0.hasPrefix(title) })
            {
                break
            }
        }
        let transcript = XCTAttachment(string: spoken.joined(separator: "\n"))
        transcript.name = "VoiceOver navigation transcript"
        transcript.lifetime = .keepAlways
        add(transcript)
        XCTAssertTrue(spoken.contains { $0.contains("Complete " + title) }, spoken.description)
        XCTAssertTrue(spoken.contains { $0.hasPrefix(title) }, spoken.description)
    }

    private func capture(_ title: String, in app: XCUIApplication, captureScreenshot: String? = nil)
    {
        app.buttons[AccessibilityIdentifier.TaskList.newTask].tap()
        let field = app.textFields[AccessibilityIdentifier.QuickAdd.field]
        XCTAssertTrue(field.waitForExistence(timeout: 6))
        if app.buttons["Continue"].exists { app.buttons["Continue"].tap() }
        field.typeText(title)
        if let captureScreenshot { screenshot(captureScreenshot, app) }
        app.buttons["Add Task"].tap()
        app.buttons["facet.quickAdd.close"].tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 4))
        XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 6))
        if app.buttons["Dismiss notice"].exists { app.buttons["Dismiss notice"].tap() }
    }
}
