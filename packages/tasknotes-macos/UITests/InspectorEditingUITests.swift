internal import Foundation
internal import TaskNotesKit
internal import XCTest

/// The inspector defects exercised against an isolated real server and vault.
final class InspectorEditingUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testSchedulingRecurrenceNotesAndUndoSurviveLifecycleChanges() throws {
        let server = try SeededServer()

        let storageFolder = "TaskNotes-UITests-\(UUID().uuidString)"
        var app = TestApp.launch(
            serverAddress: server.address,
            storageFolder: storageFolder
        ) { addTeardownBlock($0) }

        selectTask("Inspector journey", id: "TaskNotes/Inspector journey.md", in: app)
        try verifyExistingSchedule(in: app, server: server)
        try createRecurrence(in: app, server: server)
        try verifyEditingLifecycle(in: &app, server: server, storageFolder: storageFolder)
    }

    private func verifyExistingSchedule(in app: XCUIApplication, server: SeededServer) throws {
        let original = try server.contents(of: "TaskNotes/Inspector journey.md")

        // Opening a populated Scheduled field must leave the calendar visible
        // and must not produce an update merely from initializing the picker.
        element(AccessibilityIdentifier.Inspector.scheduled, in: app).click()
        XCTAssertTrue(
            element(AccessibilityIdentifier.Schedule.picker, in: app)
                .waitForExistence(timeout: 5)
        )
        element(AccessibilityIdentifier.Schedule.shortcut("today"), in: app).click()
        XCTAssertTrue(
            element(AccessibilityIdentifier.Schedule.popover, in: app)
                .waitForNonExistence(timeout: 5)
        )
        XCTAssertEqual(try server.contents(of: "TaskNotes/Inspector journey.md"), original)
    }

    private func createRecurrence(in app: XCUIApplication, server: SeededServer) throws {
        // Build a non-default weekly rule and persist its explicit anchor.
        element(AccessibilityIdentifier.Inspector.recurrenceEdit, in: app).click()
        XCTAssertTrue(
            element(AccessibilityIdentifier.Inspector.recurrenceSheet, in: app)
                .waitForExistence(timeout: 5)
        )
        element(
            AccessibilityIdentifier.Inspector.recurrenceFrequencyOption("weekly"),
            in: app
        ).click()
        element(AccessibilityIdentifier.Inspector.recurrenceApply, in: app).click()
        try waitForVault(server, containing: "recurrence: FREQ=WEEKLY;BYDAY=")
        try waitForVault(server, containing: "recurrence_anchor: scheduled")
    }

    private func verifyEditingLifecycle(
        in app: inout XCUIApplication,
        server: SeededServer,
        storageFolder: String
    ) throws {
        // Done captures the text before the editor disappears.
        editBody(to: "Saved through Done.", in: app)
        try waitForVault(server, containing: "Saved through Done.")

        // Selection changes commit and then restore the same stored body.
        selectTask("Selection target", id: "TaskNotes/Selection target.md", in: app)
        selectTask("Inspector journey", id: "TaskNotes/Inspector journey.md", in: app)
        XCTAssertTrue(app.staticTexts["Saved through Done."].waitForExistence(timeout: 5))

        // Inspector closure follows the same capture path.
        openBodyEditor(in: app)
        replaceBody(with: "Saved through inspector closure.", in: app)
        app.typeKey("i", modifierFlags: [.command, .option])
        try waitForVault(server, containing: "Saved through inspector closure.")
        app.typeKey("i", modifierFlags: [.command, .option])

        // Relaunch over the same isolated storage, then exercise both shortcut
        // and menu forms of undo after recreating the AppKit editor.
        app.terminate()
        app = TestApp.launch(
            serverAddress: server.address,
            storageFolder: storageFolder
        ) { addTeardownBlock($0) }
        selectTask("Inspector journey", id: "TaskNotes/Inspector journey.md", in: app)
        openBodyEditor(in: app)
        let editor = element(AccessibilityIdentifier.Inspector.detailsSource, in: app)
        editor.click()
        editor.typeText(" shortcut")
        app.typeKey("z", modifierFlags: [.command])
        XCTAssertEqual(editor.value as? String, "Saved through inspector closure.")

        editor.typeText(" menu")
        app.menuBars.menuBarItems["Edit"].click()
        app.menuItems.matching(NSPredicate(format: "label BEGINSWITH 'Undo'")).firstMatch.click()
        XCTAssertEqual(editor.value as? String, "Saved through inspector closure.")
    }

    private func selectTask(_ title: String, id: String, in app: XCUIApplication) {
        let row = element(AccessibilityIdentifier.TaskList.row(id), in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 15), "missing row \(title)")
        row.click()
        XCTAssertTrue(
            element(AccessibilityIdentifier.Inspector.title, in: app).waitForExistence(timeout: 5))
    }

    private func editBody(to text: String, in app: XCUIApplication) {
        openBodyEditor(in: app)
        replaceBody(with: text, in: app)
        element(AccessibilityIdentifier.Inspector.detailsMode, in: app).click()
    }

    private func openBodyEditor(in app: XCUIApplication) {
        let source = element(AccessibilityIdentifier.Inspector.detailsSource, in: app)
        if !source.exists {
            element(AccessibilityIdentifier.Inspector.detailsMode, in: app).click()
        }
        XCTAssertTrue(source.waitForExistence(timeout: 5))
    }

    private func replaceBody(with text: String, in app: XCUIApplication) {
        let source = element(AccessibilityIdentifier.Inspector.detailsSource, in: app)
        source.click()
        app.typeKey("a", modifierFlags: [.command])
        source.typeText(text)
    }

    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[identifier]
    }

    private func waitForVault(
        _ server: SeededServer,
        containing expected: String
    ) throws {
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            if try server.contents(of: "TaskNotes/Inspector journey.md").contains(expected) {
                return
            }
            Thread.sleep(forTimeInterval: 0.1)
        }
        XCTFail("vault never contained \(expected)")
    }
}

private struct SeededServer {
    let address: String
    private let vault: URL

    init() throws {
        let packageRoot = URL(filePath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let data = try Data(contentsOf: packageRoot.appending(path: ".build/ui-test-fixture.json"))
        let fixture = try JSONDecoder().decode(Fixture.self, from: data)
        address = fixture.address
        vault = URL(filePath: fixture.vault, directoryHint: .isDirectory)
    }

    func contents(of relativePath: String) throws -> String {
        try String(contentsOf: vault.appending(path: relativePath), encoding: .utf8)
    }

    private struct Fixture: Decodable {
        let address: String
        let vault: String
    }
}
