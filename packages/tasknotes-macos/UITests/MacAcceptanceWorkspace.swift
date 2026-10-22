import Foundation
import XCTest

@MainActor
enum MacAcceptanceWorkspace {
    static func initial(app: XCUIApplication) throws -> XCUIElement {
        try waitUntilReady(app)
        let windows = workspaces(app)
        let exactlyOne = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in windows.count == 1 }, object: nil)
        guard XCTWaiter.wait(for: [exactlyOne], timeout: 10) == .completed,
            windows.count == 1
        else { throw WorkspaceError.unexpectedWindowCount(expected: 1, actual: windows.count) }
        let window = try readyWindow(app: app, identifier: windows.element.identifier)
        guard windows.count == 1 else {
            throw WorkspaceError.unexpectedWindowCount(expected: 1, actual: windows.count)
        }
        return window
    }

    static func create(app: XCUIApplication) throws -> XCUIElement {
        try waitUntilReady(app)
        let existing = workspaces(app)
        guard existing.count == 1 else {
            throw WorkspaceError.unexpectedWindowCount(expected: 1, actual: existing.count)
        }
        let firstID = existing.element.identifier
        guard validWorkspaceID(firstID) else {
            throw WorkspaceError.invalidIdentity
        }
        app.menuBars.menuBarItems["File"].click()
        let newWindow = app.menuItems["New Window"]
        guard newWindow.waitForExistence(timeout: 10) else { throw WorkspaceError.creationFailed }
        newWindow.click()
        let created = app.windows.matching(
            NSPredicate(
                format: "identifier BEGINSWITH %@ AND identifier != %@", "facet.workspace.", firstID
            ))
        let exactlyTwo = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in existing.count == 2 && created.count == 1 },
            object: nil)
        guard XCTWaiter.wait(for: [exactlyTwo], timeout: 10) == .completed,
            existing.count == 2, created.count == 1,
            app.windows.matching(identifier: firstID).count == 1
        else { throw WorkspaceError.unexpectedWindowCount(expected: 2, actual: existing.count) }
        let window = try readyWindow(app: app, identifier: created.element.identifier)
        guard existing.count == 2, app.windows.matching(identifier: firstID).count == 1 else {
            throw WorkspaceError.unexpectedWindowCount(expected: 2, actual: existing.count)
        }
        return window
    }

    private static func waitUntilReady(_ app: XCUIApplication) throws {
        let fileMenu = app.menuBars.menuBarItems["File"]
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                app.state == .runningForeground && fileMenu.exists && fileMenu.isEnabled
            }, object: nil)
        guard XCTWaiter.wait(for: [ready], timeout: 20) == .completed else {
            throw WorkspaceError.creationFailed
        }
    }

    private static func readyWindow(app: XCUIApplication, identifier: String) throws -> XCUIElement
    {
        let window = try selectedWindow(app: app, identifier: identifier)
        guard window.identifier == identifier else { throw WorkspaceError.invalidIdentity }
        guard window.buttons["facet.capture.open"].waitForExistence(timeout: 10) else {
            throw WorkspaceError.captureControlUnavailable(
                identifier: identifier, appState: app.state.rawValue, appEnabled: app.isEnabled)
        }
        return window
    }

    private static func workspaces(_ app: XCUIApplication) -> XCUIElementQuery {
        app.windows.matching(NSPredicate(format: "identifier BEGINSWITH %@", "facet.workspace."))
    }

    static func selectedWindow(app: XCUIApplication, identifier: String) throws -> XCUIElement {
        let selected = app.windows.matching(identifier: identifier)
        guard validWorkspaceID(identifier), selected.count == 1 else {
            throw WorkspaceError.invalidIdentity
        }
        return selected.element
    }

    private static func validWorkspaceID(_ identifier: String) -> Bool {
        let prefix = "facet.workspace."
        guard identifier.hasPrefix(prefix),
            let uuid = UUID(uuidString: String(identifier.dropFirst(prefix.count)))
        else { return false }
        return identifier == prefix + uuid.uuidString.lowercased()
    }

    private enum WorkspaceError: Error {
        case invalidIdentity, creationFailed
        case unexpectedWindowCount(expected: Int, actual: Int)
        case captureControlUnavailable(identifier: String, appState: UInt, appEnabled: Bool)
    }
}
