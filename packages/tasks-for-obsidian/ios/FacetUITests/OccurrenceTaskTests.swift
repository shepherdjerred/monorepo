import Foundation
import XCTest

/// Only the dedicated recurrence runner selects these ordered stages.
@MainActor
final class OccurrenceTaskTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        XCTAssertNotNil(environment["FACET_E2E_SIMULATOR"])
        XCTAssertEqual(environment["FACET_E2E_SIMULATOR"], environment["SIMULATOR_UDID"])
        addUIInterruptionMonitor(withDescription: "Unexpected recurrence journey interruption") {
            _ in
            XCTFail("The owned recurrence journey was interrupted. No alert was accepted.")
            return false
        }
    }

    func testCompleteChildPreservesPrimaryWhenFutureGenerationFails() throws {
        let app = try launch()
        allTasks(app)
        XCTAssertTrue(
            future("Occurrence rolling parent", offset: 2, in: app).waitForExistence(timeout: 20))
        open("Tasks/Rolling.md", title: "Occurrence rolling parent", in: app)
        let generate = visibleButton("facet.series.generate", in: app)
        attach(app, name: "01 Rolling series exposes the real Generate control")
        generate.tap()
        XCTAssertTrue(app.textFields["facet.editor.title"].waitForNonExistence(timeout: 15))
        let complete = app.buttons["Complete Occurrence repair child"]
        XCTAssertTrue(complete.waitForExistence(timeout: 15))
        complete.tap()
        XCTAssertTrue(complete.waitForNonExistence(timeout: 15))
        acknowledgeFutureGenerationNotice(app)
        app.tabBars.buttons["Browse"].tap()
        app.buttons["Completed"].tap()
        open("Tasks/Repair-child.md", title: "Occurrence repair child", in: app)
        let repair = visibleButton("facet.series.repair", in: app)
        XCTAssertTrue(repair.isEnabled, "A preserved primary action must expose generation repair")
        attach(app, name: "02 Completed child retains actionable future generation failure")
        try stop(app)
    }

    func testExplicitRepairUndoPreservesTheCompletedPrimary() throws {
        let app = try launch()
        allTasks(app)
        performRepair(app)
        let undo = app.buttons.matching(NSPredicate(format: "label == %@", "Undo"))
        XCTAssertTrue(undo.firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(undo.count, 1)
        undo.firstMatch.tap()
        XCTAssertTrue(future("Occurrence repair parent", in: app).waitForNonExistence(timeout: 15))
        open("Tasks/Repair.md", title: "Occurrence repair parent", in: app)
        XCTAssertTrue(visibleButton("facet.series.repair", in: app).isEnabled)
        attach(app, name: "03 Repair Undo removes only the future occurrence")
        try stop(app)
    }

    func testRepairAgainSurvivesColdRelaunch() throws {
        let app = try launch()
        allTasks(app)
        performRepair(app)
        attach(app, name: "04 Explicit repair creates the future occurrence")
        try stop(app)
        app.launch()
        allTasks(app)
        XCTAssertTrue(future("Occurrence repair parent", in: app).waitForExistence(timeout: 20))
        attach(app, name: "05 Repaired future occurrence survives cold relaunch")
        try stop(app)
    }

    private func launch() throws -> XCUIApplication {
        try requireViewerDay()
        let app = XCUIApplication()
        app.launchEnvironment["FACET_E2E_SIMULATOR"] =
            ProcessInfo.processInfo.environment["FACET_E2E_SIMULATOR"]
        app.launchArguments = ["--facet-native-acceptance"]
        app.launch()
        addTeardownBlock { @MainActor in app.terminate() }
        return app
    }

    private func stop(_ app: XCUIApplication) throws {
        try requireViewerDay()
        app.terminate()
        XCTAssertEqual(app.state, .notRunning)
    }

    private func allTasks(_ app: XCUIApplication) {
        let browse = app.tabBars.buttons["Browse"]
        XCTAssertTrue(browse.waitForExistence(timeout: 20))
        browse.tap()
        let all = app.buttons["All tasks"]
        XCTAssertTrue(all.waitForExistence(timeout: 10))
        all.tap()
    }

    private func open(_ path: String, title: String, in app: XCUIApplication) {
        let row = app.descendants(matching: .any).matching(identifier: "facet.task.\(path)")
            .firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        let open = row.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title))
        XCTAssertEqual(open.count, 1)
        open.element.tap()
        XCTAssertTrue(app.textFields["facet.editor.title"].waitForExistence(timeout: 10))
    }

    private func performRepair(_ app: XCUIApplication) {
        open("Tasks/Repair.md", title: "Occurrence repair parent", in: app)
        visibleButton("facet.series.repair", in: app).tap()
        XCTAssertTrue(app.textFields["facet.editor.title"].waitForNonExistence(timeout: 15))
        XCTAssertTrue(future("Occurrence repair parent", in: app).waitForExistence(timeout: 15))
    }

    private func visibleButton(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let button = app.buttons[identifier]
        for _ in 0..<6 {
            if button.exists && button.isHittable { return button }
            app.swipeUp()
        }
        XCTAssertTrue(
            button.exists && button.isHittable, "The real series control must be reachable")
        return button
    }

    private func future(_ title: String, offset: Int = 1, in app: XCUIApplication) -> XCUIElement {
        let environment = ProcessInfo.processInfo.environment
        let formatter = dateFormatter()
        let day = environment["FACET_OCCURRENCE_DAY"] ?? ""
        guard let date = formatter.date(from: day) else {
            XCTFail("The runner must provide its captured viewer day")
            return app.staticTexts["Invalid occurrence day"]
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = formatter.timeZone
        guard let next = calendar.date(byAdding: .day, value: offset, to: date) else {
            XCTFail("The captured occurrence day cannot advance")
            return app.staticTexts["Invalid occurrence day"]
        }
        return app.staticTexts["\(title) \(formatter.string(from: next))"]
    }

    private func requireViewerDay() throws {
        let day = try XCTUnwrap(ProcessInfo.processInfo.environment["FACET_OCCURRENCE_DAY"])
        XCTAssertEqual(
            dateFormatter().string(from: Date()), day,
            "The real simulator viewer day must match the seeded day")
    }

    private func dateFormatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }

    private func attach(_ app: XCUIApplication, name: String) {
        XCTAssertEqual(app.alerts.count, 0)
        requirePrivateOwnedApp(app)
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = name
        evidence.lifetime = .keepAlways
        add(evidence)
    }

    private func acknowledgeFutureGenerationNotice(_ app: XCUIApplication) {
        let alert = app.alerts["Saved"]
        XCTAssertTrue(alert.waitForExistence(timeout: 15))
        XCTAssertEqual(app.alerts.count, 1)
        XCTAssertTrue(alert.isHittable)
        let message = "Future occurrences need attention in the task’s Series section."
        XCTAssertEqual(
            alert.staticTexts.allElementsBoundByIndex.map(\.label).sorted(),
            ["Saved", message].sorted())
        XCTAssertEqual(alert.buttons.count, 1)
        let okay = alert.buttons["OK"]
        XCTAssertTrue(okay.exists && okay.isEnabled && okay.isHittable)
        requirePrivateOwnedApp(app)
        let evidence = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        evidence.name = "02 Saved completion explicitly warns about future generation"
        evidence.lifetime = .keepAlways
        add(evidence)
        okay.tap()
        XCTAssertTrue(alert.waitForNonExistence(timeout: 10))
        XCTAssertEqual(app.alerts.count, 0)
    }

    private func requirePrivateOwnedApp(_ app: XCUIApplication) {
        let environment = ProcessInfo.processInfo.environment
        XCTAssertNotNil(environment["FACET_E2E_SIMULATOR"])
        XCTAssertEqual(environment["FACET_E2E_SIMULATOR"], environment["SIMULATOR_UDID"])
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertEqual(app.secureTextFields.count, 0)
        for identifier in [
            "facet.account.email", "facet.account.password", "facet.account.code",
            "facet.account.vault-password", "facet.account.error",
        ] {
            XCTAssertFalse(app.descendants(matching: .any)[identifier].exists)
        }
    }
}
