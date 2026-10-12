import Foundation
import XCTest

/// The harness records profile identity, pending outbox and file hashes around
/// these UI stages. Owner credential entry happens between them, unrecorded.
@MainActor
final class LiveSyncLifecycleUITests: XCTestCase {
    private struct Descriptor: Decodable {
        let schemaVersion: UInt32
        let runID: UUID
        let stateDirectory: String
        let allowedRemoteVaultID: String?
    }
    private enum OwnershipError: Error { case descriptor, application, simulator }

    func testSignOutPreservesPendingTaskAndColdReplica() async throws {
        let journey = try launch()
        let app = journey.app
        let initialSurface = journey.surface
        let title = journey.title
        waitForPhase("offline", surface: initialSurface)
        XCTAssertTrue(task(title, surface: initialSurface).waitForExistence(timeout: 20))
        activate(control("facet.settings.open", surface: initialSurface))
        let signOut = control("facet.account.signout", surface: initialSurface)
        XCTAssertTrue(signOut.waitForExistence(timeout: 5))
        activate(signOut)
        #if os(iOS)
            let done = app.buttons["facet.settings.done"]
            XCTAssertTrue(done.waitForExistence(timeout: 5))
            activate(done)
        #endif
        waitForPhase("reconnectRequired", surface: initialSurface)
        XCTAssertTrue(task(title, surface: initialSurface).exists)
        try await attach(
            app, surface: initialSurface, "Signed out with pending task retained locally")
        app.terminate()
        app.launch()
        let surface = try workspace(app)
        XCTAssertTrue(task(title, surface: surface).waitForExistence(timeout: 30))
        XCTAssertEqual(tasks(title, surface: surface).count, 1)
        waitForPhase("reconnectRequired", surface: surface)
        try await attach(app, surface: surface, "Signed-out replica survives cold relaunch")
        app.terminate()
    }

    func testReauthorizedReplicaRetainsTaskAndColdRelaunch() async throws {
        let journey = try launch()
        let app = journey.app
        let initialSurface = journey.surface
        let title = journey.title
        waitForPhase("synced", surface: initialSurface)
        XCTAssertTrue(task(title, surface: initialSurface).waitForExistence(timeout: 30))
        XCTAssertEqual(tasks(title, surface: initialSurface).count, 1)
        try await attach(
            app, surface: initialSurface, "Reauthorized original replica has one retained task")
        app.terminate()
        app.launch()
        let surface = try workspace(app)
        waitForPhase("synced", surface: surface)
        XCTAssertTrue(task(title, surface: surface).waitForExistence(timeout: 30))
        XCTAssertEqual(tasks(title, surface: surface).count, 1)
        try await attach(
            app, surface: surface, "Reauthorized replica converges after cold relaunch")
        app.terminate()
    }

    private func launch() throws -> LiveLifecycleJourney {
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
        #if os(macOS)
            _ = try MacAcceptanceOwnership.validate(
                descriptor: path, stateDirectory: descriptor.stateDirectory, runID: runID)
        #endif
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
        return LiveLifecycleJourney(app: app, surface: try workspace(app), title: title)
    }

    private func workspace(_ app: XCUIApplication) throws -> XCUIElement {
        #if os(macOS)
            try MacAcceptanceWorkspace.create(app: app)
        #else
            app
        #endif
    }

    private func waitForPhase(_ phase: String, surface: XCUIElement) {
        #if os(macOS)
            let status = surface.descendants(matching: .any).matching(
                identifier: "facet.sync.status"
            ).element
        #else
            let status = surface.descendants(matching: .any)["facet.sync.status"].firstMatch
        #endif
        XCTAssertTrue(status.waitForExistence(timeout: 30))
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", phase), object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 120), .completed)
    }

    private func tasks(_ title: String, surface: XCUIElement) -> XCUIElementQuery {
        #if os(macOS)
            surface.staticTexts.matching(NSPredicate(format: "value == %@", title))
        #else
            surface.buttons.matching(NSPredicate(format: "label == %@", title))
        #endif
    }

    private func task(_ title: String, surface: XCUIElement) -> XCUIElement {
        #if os(macOS)
            tasks(title, surface: surface).element
        #else
            tasks(title, surface: surface).firstMatch
        #endif
    }

    private func control(_ identifier: String, surface: XCUIElement) -> XCUIElement {
        #if os(macOS)
            surface.descendants(matching: .any).matching(identifier: identifier).element
        #else
            surface.descendants(matching: .any)[identifier].firstMatch
        #endif
    }

    private func activate(_ element: XCUIElement) {
        #if os(macOS)
            element.click()
        #else
            element.tap()
        #endif
    }

    private func attach(_ app: XCUIApplication, surface: XCUIElement, _ name: String) async throws {
        #if os(macOS)
            try await MacAcceptanceCapture.attach(
                app: app, name: name, test: self, windows: [surface])
        #else
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        #endif
    }
}

private struct LiveLifecycleJourney {
    let app: XCUIApplication
    let surface: XCUIElement
    let title: String
}
