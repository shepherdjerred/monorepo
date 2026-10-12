import Foundation
import XCTest

@MainActor
enum MacAcceptanceWorkspace {
    static func create(app: XCUIApplication) throws -> XCUIElement {
        let fileMenu = app.menuBars.menuBarItems["File"]
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                app.state == .runningForeground && fileMenu.exists && fileMenu.isEnabled
            }, object: nil)
        guard XCTWaiter.wait(for: [ready], timeout: 20) == .completed else {
            throw WorkspaceError.creationFailed
        }
        let existing = app.windows.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "facet.workspace."))
        let existingIDs = existing.allElementsBoundByIndex.map(\.identifier)
        guard Set(existingIDs).count == existingIDs.count,
            existingIDs.allSatisfy({ validWorkspaceID($0) })
        else { throw WorkspaceError.invalidIdentity }
        fileMenu.click()
        let newWindow = app.menuItems["New Window"]
        guard newWindow.waitForExistence(timeout: 10) else { throw WorkspaceError.creationFailed }
        newWindow.click()
        let created = app.windows.matching(
            NSPredicate(
                format: "identifier BEGINSWITH %@ AND NOT (identifier IN %@)", "facet.workspace.",
                existingIDs))
        let exactlyOne = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in created.count == 1 }, object: nil)
        guard XCTWaiter.wait(for: [exactlyOne], timeout: 10) == .completed,
            created.count == 1
        else { throw WorkspaceError.creationFailed }
        let identifier = created.element.identifier
        let window = try selectedWindow(app: app, identifier: identifier)
        guard window.identifier == identifier,
            window.buttons["facet.capture.open"].waitForExistence(timeout: 10)
        else { throw WorkspaceError.invalidIdentity }
        return window
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

    private enum WorkspaceError: Error { case invalidIdentity, creationFailed }
}
