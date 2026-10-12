import Foundation
import TaskNotesKit
import XCTest

@MainActor
final class StandaloneVaultUITests: XCTestCase {
    func testNativeVaultCaptureEditAndRelaunch() async throws {
        let context = try launch("Native Mac")
        let app = context.app
        var window = try workspace(app)
        capture(context.title, app: app, window: window, usingShortcut: true)
        task(context.title, window).click()
        let edited = context.title + " edited"
        replace(window.textFields["facet.inspector.title"], with: edited)
        window.textFields["facet.inspector.title"].typeKey(.return, modifierFlags: [])
        XCTAssertTrue(task(edited, window).waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        window = try workspace(app)
        XCTAssertTrue(task(edited, window).waitForExistence(timeout: 20))
        try await attach(
            app, windows: [window], "01 Standalone capture and edit survive cold relaunch")
        click(window.buttons["Complete \(edited)"])
        XCTAssertTrue(task(edited, window).waitForNonExistence(timeout: 10))
        click(window.buttons["Completed"])
        XCTAssertTrue(task(edited, window).waitForExistence(timeout: 10))
        _ = try context.waitForNote(edited, status: "done")
        try await attach(app, windows: [window], "02 Standalone completion persisted")
        click(window.buttons["Uncomplete \(edited)"])
        XCTAssertTrue(task(edited, window).waitForNonExistence(timeout: 10))
        click(window.buttons["Inbox"])
        XCTAssertTrue(task(edited, window).waitForExistence(timeout: 10))
        let beforeDelete = try context.waitForNote(edited, status: "open")
        task(edited, window).click()
        window.typeKey(.delete, modifierFlags: .command)
        click(window.buttons["Delete"])
        XCTAssertTrue(task(edited, window).waitForNonExistence(timeout: 10))
        try context.waitForAbsence(edited)
        try await attach(app, windows: [window], "03 Standalone deletion removed the note")
        window.typeKey("z", modifierFlags: [.command, .option])
        XCTAssertTrue(task(edited, window).waitForExistence(timeout: 10))
        let restored = try context.waitForNote(edited, status: "open")
        XCTAssertEqual(
            restored, beforeDelete, "Undo must restore the exact pre-delete Markdown bytes.")
        app.terminate()
        app.launch()
        window = try workspace(app)
        XCTAssertTrue(task(edited, window).waitForExistence(timeout: 20))
        try await attach(
            app, windows: [window], "04 Reopen and deletion undo survive cold relaunch")
    }

    func testDirtyInspectorNavigationAndWindowClosePreserveChanges() async throws {
        let context = try launch("Draft Mac")
        let app = context.app
        var window = try workspace(app)
        capture(context.title, app: app, window: window)
        task(context.title, window).click()
        let navigated = context.title + " navigated"
        replace(window.textFields["facet.inspector.title"], with: navigated)
        // No Return: navigation must drain the owning dirty inspector.
        click(window.buttons["Today"])
        _ = try context.waitForNote(navigated)
        click(window.buttons["Inbox"])
        XCTAssertTrue(task(navigated, window).waitForExistence(timeout: 10))
        task(navigated, window).click()
        let closed = context.title + " closed"
        replace(window.textFields["facet.inspector.title"], with: closed)
        window.typeKey("w", modifierFlags: .command)
        XCTAssertTrue(window.waitForNonExistence(timeout: 10))
        _ = try context.waitForNote(closed)
        app.terminate()
        app.launch()
        window = try workspace(app)
        XCTAssertTrue(task(closed, window).waitForExistence(timeout: 20))
        try await attach(
            app, windows: [window],
            "05 Dirty inspector flushes on navigation and normal window close")
    }

    func testIndependentWindowQueriesAndSelections() async throws {
        let context = try launch("Windows Mac")
        let app = context.app
        let first = try workspace(app)
        capture(context.title, app: app, window: first)
        task(context.title, first).click()
        first.typeKey("f", modifierFlags: .command)
        let firstSearch = first.searchFields.firstMatch
        XCTAssertTrue(firstSearch.waitForExistence(timeout: 5))
        firstSearch.typeText(context.title)
        XCTAssertTrue(task("E2E existing task", first).waitForNonExistence(timeout: 10))
        let second = try MacAcceptanceWorkspace.create(app: app)
        XCTAssertNotEqual(first.identifier, second.identifier)
        XCTAssertEqual(
            app.windows.matching(
                NSPredicate(format: "identifier BEGINSWITH %@", "facet.workspace.")
            ).count, 2)
        XCTAssertTrue(task("E2E existing task", second).waitForExistence(timeout: 10))
        task("E2E existing task", second).click()
        XCTAssertEqual(
            second.textFields["facet.inspector.title"].value as? String, "E2E existing task")
        XCTAssertEqual(first.textFields["facet.inspector.title"].value as? String, context.title)
        XCTAssertEqual(firstSearch.value as? String, context.title)
        assertAccountSheetOwnership(app: app, window: second)
        second.typeKey("f", modifierFlags: .command)
        let search = second.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.typeText("E2E existing task")
        XCTAssertTrue(task(context.title, second).waitForNonExistence(timeout: 10))
        XCTAssertTrue(task(context.title, first).exists)
        XCTAssertEqual(firstSearch.value as? String, context.title)
        try await attach(
            app, windows: [first, second],
            "06 Two native windows retain independent search and selection")
        second.typeKey("w", modifierFlags: .command)
        XCTAssertTrue(second.waitForNonExistence(timeout: 10))
        firstSearch.click()
        firstSearch.typeKey("a", modifierFlags: .command)
        firstSearch.typeKey(.delete, modifierFlags: [])
        XCTAssertTrue(task("E2E existing task", first).waitForExistence(timeout: 10))
        _ = try context.waitForNote(context.title)
    }

    func testQuickAddRetainsHiddenDraftAndAddsAnother() async throws {
        let context = try launch("Quick Mac")
        let app = context.app
        var window = try workspace(app)
        window.typeKey("n", modifierFlags: [.command, .shift])
        let panel = app.windows["red.sjer.tasknotes.quickAdd"]
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        let field = panel.textFields["red.sjer.tasknotes.quickAdd.field"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText(context.title)
        field.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(panel.waitForNonExistence(timeout: 5))
        window.typeKey("n", modifierFlags: [.command, .shift])
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        XCTAssertEqual(field.value as? String, context.title)
        field.typeText(" retained")
        click(panel.buttons["Add Another"])
        let cleared = await XCTWaiter.fulfillment(
            of: [
                XCTNSPredicateExpectation(
                    predicate: NSPredicate(format: "value == %@", ""), object: field)
            ], timeout: 10)
        XCTAssertEqual(cleared, .completed)
        XCTAssertTrue(panel.exists)
        field.typeKey(.escape, modifierFlags: [])
        let title = context.title + " retained"
        XCTAssertTrue(task(title, window).waitForExistence(timeout: 10))
        _ = try context.waitForNote(title)
        app.terminate()
        app.launch()
        window = try workspace(app)
        XCTAssertTrue(task(title, window).waitForExistence(timeout: 20))
        try await attach(
            app, windows: [window],
            "07 Standalone Quick Add retains hidden drafts and persists Add Another")
    }
}

extension StandaloneVaultUITests {
    private func launch(_ prefix: String) throws -> LocalJourney {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        let descriptor = try XCTUnwrap(environment["FACET_E2E_DESCRIPTOR"])
        let runID = try XCTUnwrap(environment["FACET_E2E_RUN_ID"].flatMap(UUID.init(uuidString:)))
        let configuration = try JSONDecoder().decode(
            AcceptanceDescriptor.self,
            from: Data(contentsOf: URL(fileURLWithPath: descriptor)))
        let state = try MacAcceptanceOwnership.validate(
            descriptor: descriptor, stateDirectory: configuration.stateDirectory, runID: runID)
        guard configuration.schemaVersion == 1,
            configuration.runID == runID, configuration.allowedRemoteVaultID == nil
        else { throw LocalAcceptanceLaunchError.invalidOwnership }
        let app = XCUIApplication(bundleIdentifier: "red.sjer.tasknotes.mac.acceptance")
        addTeardownBlock { @MainActor in app.terminate() }
        app.launchArguments = [
            "--facet-acceptance-descriptor", descriptor, "--facet-native-acceptance",
        ]
        app.launch()
        return LocalJourney(
            app: app, title: prefix + " " + runID.uuidString.lowercased(),
            vault: state.appendingPathComponent("Native acceptance"))
    }

    private func workspace(_ app: XCUIApplication) throws -> XCUIElement {
        try MacAcceptanceWorkspace.initial(app: app)
    }

    private func capture(
        _ title: String, app: XCUIApplication, window: XCUIElement, usingShortcut: Bool = false
    ) {
        if usingShortcut {
            window.typeKey("n", modifierFlags: .command)
        } else {
            click(window.buttons["facet.capture.open"])
        }
        let field = window.textFields["facet.capture.title"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertEqual(window.sheets.count, 1, "Only the selected workspace presents capture.")
        XCTAssertEqual(window.textFields.matching(identifier: "facet.capture.title").count, 1)
        for other in app.windows.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "facet.workspace.")
        ).allElementsBoundByIndex where other.identifier != window.identifier {
            XCTAssertEqual(other.sheets.count, 0, "Capture must not open in another workspace.")
            XCTAssertEqual(other.textFields.matching(identifier: "facet.capture.title").count, 0)
        }
        field.click()
        field.typeText(title)
        click(window.buttons["facet.capture.submit"])
        XCTAssertTrue(task(title, window).waitForExistence(timeout: 10))
    }

    private func task(_ title: String, _ parent: XCUIElement) -> XCUIElement {
        parent.staticTexts.matching(NSPredicate(format: "value == %@", title)).element
    }

    private func assertAccountSheetOwnership(app: XCUIApplication, window: XCUIElement) {
        click(
            window.descendants(matching: .any).matching(identifier: "facet.settings.open").element)
        let account = app.menuItems.matching(identifier: "facet.account.open")
        XCTAssertTrue(account.element.waitForExistence(timeout: 5))
        XCTAssertEqual(account.count, 1)
        account.element.click()
        let email = window.textFields.matching(identifier: "facet.account.email")
        XCTAssertTrue(email.element.waitForExistence(timeout: 10))
        XCTAssertEqual(email.count, 1)
        XCTAssertEqual(window.sheets.count, 1)
        for other in app.windows.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "facet.workspace.")
        ).allElementsBoundByIndex where other.identifier != window.identifier {
            XCTAssertEqual(
                other.sheets.count, 0, "Account must belong to the requesting workspace.")
            XCTAssertEqual(other.textFields.matching(identifier: "facet.account.email").count, 0)
        }
        click(window.sheets.element.buttons["facet.account.done"])
        XCTAssertTrue(email.element.waitForNonExistence(timeout: 10))
        XCTAssertEqual(window.sheets.count, 0)
    }

    private func click(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: 10))
        element.click()
    }

    private func replace(_ field: XCUIElement, with text: String) {
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.click()
        field.typeKey("a", modifierFlags: .command)
        field.typeText(text)
        XCTAssertEqual(field.value as? String, text)
    }

    private func attach(_ app: XCUIApplication, windows: [XCUIElement], _ name: String) async throws
    {
        let forbidden = [
            "facet.account.email", "facet.account.password", "facet.account.code",
            "facet.account.vault-password", "facet.account.signin", "facet.account.error",
        ]
        guard windows.allSatisfy({ $0.buttons["facet.capture.open"].exists }),
            app.alerts.count == 0,
            !forbidden.contains(where: { app.descendants(matching: .any)[$0].firstMatch.exists })
        else {
            XCTFail("Screenshot requires the synthetic workspace without account entry or errors.")
            return
        }
        try await MacAcceptanceCapture.attach(app: app, name: name, test: self, windows: windows)
    }
}

private struct LocalJourney {
    let app: XCUIApplication
    let title: String
    let vault: URL

    func waitForNote(_ title: String, status: String? = nil) throws -> Data {
        let deadline = Date().addingTimeInterval(10)
        repeat {
            if let note = try note(title) {
                if let status {
                    if note.document.properties["status"] == .string(status) { return note.bytes }
                } else {
                    return note.bytes
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
        throw LocalAcceptanceLaunchError.noteDidNotConverge
    }

    func waitForAbsence(_ title: String) throws {
        let deadline = Date().addingTimeInterval(10)
        repeat {
            if try note(title) == nil { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
        throw LocalAcceptanceLaunchError.noteDidNotConverge
    }

    private func note(_ title: String) throws -> LocalNote? {
        let enumerator = try XCTUnwrap(
            FileManager.default.enumerator(
                at: vault,
                includingPropertiesForKeys: [.isRegularFileKey]))
        var result: LocalNote?
        for case let url as URL in enumerator where url.pathExtension == "md" {
            let bytes = try Data(contentsOf: url)
            let path = String(url.path.dropFirst(vault.path.count + 1))
            let document = try FacetMarkdownDocument(path: path, bytes: bytes)
            if document.properties["title"] == .string(title) {
                XCTAssertNil(result, "Exactly one note must own the synthetic task title.")
                result = LocalNote(bytes: bytes, document: document)
            }
        }
        return result
    }
}

private struct LocalNote {
    let bytes: Data
    let document: FacetMarkdownDocument
}

private struct AcceptanceDescriptor: Decodable {
    let schemaVersion: Int
    let runID: UUID
    let stateDirectory: String
    let allowedRemoteVaultID: String?
}

private enum LocalAcceptanceLaunchError: Error { case invalidOwnership, noteDidNotConverge }
