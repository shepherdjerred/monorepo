import Darwin
import Foundation
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

    func testDeleteUndoRestoresTheReopenedTask() throws {
        let note = try ownedNote()
        let beforeDelete = try Data(contentsOf: note)
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
        let descriptor = Darwin.open(note.path, O_RDONLY | O_NOFOLLOW)
        if descriptor >= 0 {
            Darwin.close(descriptor)
            XCTFail("The task row disappeared without deleting its actual Markdown file.")
            return
        }
        let readError = errno
        XCTAssertEqual(readError, ENOENT, "Deletion must produce ENOENT, never access denial.")
        guard readError == ENOENT else { return }
        let undo = app.buttons.matching(NSPredicate(format: "label == %@", "Undo")).firstMatch
        XCTAssertTrue(undo.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(undo.isHittable, app.debugDescription)
        attach(app, "02 Deletion removes the task and offers Undo")
        undo.tap()
        XCTAssertTrue(task(in: app).waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(try Data(contentsOf: note), beforeDelete)
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

    private func ownedNote() throws -> URL {
        let environment = ProcessInfo.processInfo.environment
        let simulator = try XCTUnwrap(environment["FACET_E2E_SIMULATOR"])
        XCTAssertEqual(simulator, environment["SIMULATOR_UDID"])
        _ = try XCTUnwrap(environment["FACET_MUTATION_RUN_ID"].flatMap(UUID.init(uuidString:)))
        let path = try XCTUnwrap(environment["FACET_MUTATION_TASK_PATH"])
        let note = URL(fileURLWithPath: path).standardizedFileURL
        XCTAssertEqual(note.path, path)
        XCTAssertEqual(note.resolvingSymlinksInPath().path, path)
        let container = note.deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        _ = try XCTUnwrap(UUID(uuidString: container.lastPathComponent))
        let suffix = [
            "CoreSimulator", "Devices", simulator, "data", "Containers", "Data", "Application",
            container.lastPathComponent, "Documents", "Native acceptance", "Tasks", "Mutation.md",
        ]
        XCTAssertEqual(Array(note.pathComponents.suffix(suffix.count)), suffix)
        let metadata = try note.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        XCTAssertEqual(metadata.isRegularFile, true)
        XCTAssertEqual(metadata.isSymbolicLink, false)
        return note
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }
}
