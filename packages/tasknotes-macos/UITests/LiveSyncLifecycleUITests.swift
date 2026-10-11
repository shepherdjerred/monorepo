import Foundation
import XCTest

/// The harness records profile identity, pending outbox and file hashes around
/// these UI stages. Owner credential entry happens between them, unrecorded.
@MainActor
final class LiveSyncLifecycleUITests: XCTestCase {
    private struct Descriptor: Decodable {
        let schemaVersion: UInt32
        let runID: UUID
        let allowedRemoteVaultID: String?
    }
    private enum OwnershipError: Error { case descriptor, application, simulator }

    func testSignOutPreservesPendingTaskAndColdReplica() throws {
        let (app, title) = try launch()
        waitForPhase("offline", app: app)
        XCTAssertTrue(tasks(title, app: app).firstMatch.waitForExistence(timeout: 20))
        activate(app.descendants(matching: .any)["facet.settings.open"].firstMatch)
        let signOut = app.descendants(matching: .any)["facet.account.signout"].firstMatch
        XCTAssertTrue(signOut.waitForExistence(timeout: 5))
        activate(signOut)
        #if os(iOS)
            let done = app.buttons["facet.settings.done"]
            XCTAssertTrue(done.waitForExistence(timeout: 5))
            activate(done)
        #endif
        waitForPhase("reconnectRequired", app: app)
        XCTAssertTrue(tasks(title, app: app).firstMatch.exists)
        attach(app, "Signed out with pending task retained locally")
        app.terminate()
        app.launch()
        XCTAssertTrue(tasks(title, app: app).firstMatch.waitForExistence(timeout: 30))
        XCTAssertEqual(tasks(title, app: app).count, 1)
        waitForPhase("reconnectRequired", app: app)
        attach(app, "Signed-out replica survives cold relaunch")
        app.terminate()
    }

    func testReauthorizedReplicaRetainsTaskAndColdRelaunch() throws {
        let (app, title) = try launch()
        waitForPhase("synced", app: app)
        XCTAssertTrue(tasks(title, app: app).firstMatch.waitForExistence(timeout: 30))
        XCTAssertEqual(tasks(title, app: app).count, 1)
        attach(app, "Reauthorized original replica has one retained task")
        app.terminate()
        app.launch()
        waitForPhase("synced", app: app)
        XCTAssertTrue(tasks(title, app: app).firstMatch.waitForExistence(timeout: 30))
        XCTAssertEqual(tasks(title, app: app).count, 1)
        attach(app, "Reauthorized replica converges after cold relaunch")
        app.terminate()
    }

    private func launch() throws -> (XCUIApplication, String) {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        let path = try XCTUnwrap(environment["FACET_E2E_DESCRIPTOR"])
        let runID = try XCTUnwrap(environment["FACET_E2E_RUN_ID"].flatMap(UUID.init(uuidString:)))
        let vaultID = try XCTUnwrap(environment["FACET_E2E_REMOTE_VAULT_ID"])
        let title = try XCTUnwrap(environment["FACET_E2E_LIFECYCLE_TITLE"])
        #if os(iOS)
            guard path == "@documents/acceptance.json" else { throw OwnershipError.descriptor }
            let bytes = Data(try XCTUnwrap(environment["FACET_E2E_DESCRIPTOR_JSON"]).utf8)
        #else
            guard path.hasPrefix("/") else { throw OwnershipError.descriptor }
            let bytes = try Data(contentsOf: URL(fileURLWithPath: path))
        #endif
        let descriptor = try JSONDecoder().decode(Descriptor.self, from: bytes)
        guard descriptor.schemaVersion == 1, descriptor.runID == runID,
            descriptor.allowedRemoteVaultID == vaultID, !vaultID.isEmpty,
            title.contains(runID.uuidString.lowercased())
        else { throw OwnershipError.descriptor }
        let app = XCUIApplication()
        app.launchArguments = ["--facet-acceptance-descriptor", path]
        #if os(iOS)
            let simulator = try XCTUnwrap(environment["FACET_E2E_SIMULATOR"])
            guard UUID(uuidString: simulator) != nil, simulator == environment["SIMULATOR_UDID"]
            else { throw OwnershipError.simulator }
            app.launchEnvironment["FACET_E2E_SIMULATOR"] = simulator
        #else
            guard environment["FACET_E2E_APP_BUNDLE_ID"] == "red.sjer.tasknotes.mac.acceptance"
            else { throw OwnershipError.application }
        #endif
        app.launch()
        addTeardownBlock { @MainActor in app.terminate() }
        return (app, title)
    }

    private func waitForPhase(_ phase: String, app: XCUIApplication) {
        let status = app.descendants(matching: .any)["facet.sync.status"].firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 30))
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", phase), object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 120), .completed)
    }

    private func tasks(_ title: String, app: XCUIApplication) -> XCUIElementQuery {
        #if os(macOS)
            app.staticTexts.matching(NSPredicate(format: "label == %@", title))
        #else
            app.buttons.matching(NSPredicate(format: "label == %@", title))
        #endif
    }

    private func activate(_ element: XCUIElement) {
        #if os(macOS)
            element.click()
        #else
            element.tap()
        #endif
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
