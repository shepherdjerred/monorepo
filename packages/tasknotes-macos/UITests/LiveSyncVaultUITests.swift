import Foundation
import XCTest

/// Requires a bound, already authenticated synthetic acceptance run. Account
/// entry is an owner checkpoint before XCTest begins retaining screenshots.
@MainActor
final class LiveSyncVaultUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "Unexpected interruption during live vault test")
        {
            _ in
            XCTFail("The authenticated vault journey was interrupted. No alert was accepted.")
            return false
        }
    }

    func testCaptureEditCompleteUncompleteAndColdRelaunch() throws {
        let (app, title) = try launchJourney(prefix: "Live")
        waitUntilSynced(app)
        attach(app, "01 Authenticated and synced")
        let edited = captureAndEdit(title: title, app: app)
        app.terminate()
        app.launch()
        XCTAssertTrue(task(edited, app).waitForExistence(timeout: 30))
        waitUntilSynced(app)
        attach(app, "03 Edit survives cold relaunch")
        completeAndReopen(edited: edited, app: app)
    }

    func testOfflineCaptureEditAndColdRelaunchRetainPendingChanges() throws {
        let prefix = ProcessInfo.processInfo.environment["FACET_E2E_CAPTURE_PREFIX"] ?? "Offline"
        guard ["Offline", "Lifecycle"].contains(prefix) else {
            throw LiveLaunchError.invalidOwnership
        }
        let (app, title) = try launchJourney(prefix: prefix)
        waitUntilPhase("offline", app)
        let edited = captureAndEdit(title: title, app: app, offline: true)
        waitUntilPhase("offline", app)
        attach(app, "01 Offline capture and edit retained")
        app.terminate()
        app.launch()
        XCTAssertTrue(task(edited, app).waitForExistence(timeout: 30))
        waitUntilPhase("offline", app)
        attach(app, "02 Pending changes survive cold relaunch offline")
    }

    private func launchJourney(prefix: String) throws -> (XCUIApplication, String) {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        let descriptor = try XCTUnwrap(environment["FACET_E2E_DESCRIPTOR"])
        let runID = try XCTUnwrap(environment["FACET_E2E_RUN_ID"].flatMap(UUID.init(uuidString:)))
        let round = try XCTUnwrap(environment["FACET_E2E_ROUND"].flatMap(Int.init))
        guard (1...3).contains(round) else { throw LiveLaunchError.invalidOwnership }
        let vaultID = try XCTUnwrap(environment["FACET_E2E_VAULT_ID"])
        guard !vaultID.isEmpty else { throw LiveLaunchError.invalidOwnership }
        try validateDescriptor(
            environment: environment, path: descriptor, runID: runID, vaultID: vaultID)
        #if os(iOS)
            guard descriptor == "@documents/acceptance.json" else {
                throw LiveLaunchError.invalidOwnership
            }
            let app = XCUIApplication(
                bundleIdentifier: "org.reactjs.native.example.TasksForObsidian")
        #else
            guard environment["FACET_E2E_APP_BUNDLE_ID"] == "red.sjer.tasknotes.mac.acceptance",
                descriptor.hasPrefix("/")
            else { throw LiveLaunchError.invalidOwnership }
            let app = XCUIApplication(bundleIdentifier: "red.sjer.tasknotes.mac.acceptance")
        #endif
        app.launchArguments = ["--facet-acceptance-descriptor", descriptor]
        #if os(iOS)
            let simulator = try XCTUnwrap(environment["FACET_E2E_SIMULATOR"])
            guard UUID(uuidString: simulator) != nil, simulator == environment["SIMULATOR_UDID"]
            else {
                throw LiveLaunchError.invalidOwnership
            }
            app.launchEnvironment["FACET_E2E_SIMULATOR"] = simulator
            let platform = "iOS"
        #else
            let platform = "macOS"
        #endif
        app.launch()
        addTeardownBlock { @MainActor in app.terminate() }
        return (app, "\(prefix) \(platform) \(runID.uuidString.lowercased())-\(round)")
    }

    private func validateDescriptor(
        environment: [String: String], path: String, runID: UUID, vaultID: String
    ) throws {
        #if os(iOS)
            let descriptorJSON = try XCTUnwrap(environment["FACET_E2E_DESCRIPTOR_JSON"])
            let bytes = Data(descriptorJSON.utf8)
        #else
            let bytes = try Data(contentsOf: URL(fileURLWithPath: path))
        #endif
        let configuration = try JSONDecoder().decode(LiveDescriptor.self, from: bytes)
        guard configuration.schemaVersion == 1, configuration.runID == runID,
            configuration.allowedRemoteVaultID == vaultID
        else { throw LiveLaunchError.invalidOwnership }
    }

    private func captureAndEdit(title: String, app: XCUIApplication, offline: Bool = false)
        -> String
    {
        activate(app.buttons["facet.capture.open"])
        let capture = app.textFields["facet.capture.title"]
        XCTAssertTrue(capture.waitForExistence(timeout: 10))
        activate(capture)
        capture.typeText(title)
        activate(app.buttons["facet.capture.submit"])
        let created = task(title, app)
        XCTAssertTrue(created.waitForExistence(timeout: 20))
        if offline {
            waitUntilPhase("offline", app)
            attach(app, "Captured locally while offline")
        } else {
            waitUntilSynced(app)
            attach(app, "02 Captured and uploaded")
        }
        activate(created)
        #if os(macOS)
            let editor = app.textFields["facet.inspector.title"]
        #else
            let editor = app.textFields["facet.editor.title"]
        #endif
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        activate(editor)
        #if os(macOS)
            editor.typeKey("a", modifierFlags: .command)
        #else
            editor.press(forDuration: 1.1)
            let selectAll = app.descendants(matching: .any).matching(
                NSPredicate(format: "label == %@", "Select All")
            ).firstMatch
            XCTAssertTrue(selectAll.waitForExistence(timeout: 5))
            selectAll.tap()
        #endif
        let edited = title + " edited"
        editor.typeText(edited)
        XCTAssertEqual(editor.value as? String, edited)
        #if os(macOS)
            editor.typeKey(.return, modifierFlags: [])
        #else
            activate(app.buttons["facet.editor.save"])
        #endif
        XCTAssertTrue(task(edited, app).waitForExistence(timeout: 20))
        return edited
    }

    private func completeAndReopen(edited: String, app: XCUIApplication) {
        activate(app.buttons["Complete \(edited)"])
        XCTAssertTrue(task(edited, app).waitForNonExistence(timeout: 20))
        #if os(iOS)
            app.tabBars.buttons["Browse"].tap()
        #endif
        activate(app.buttons["Completed"])
        XCTAssertTrue(task(edited, app).waitForExistence(timeout: 20))
        waitUntilSynced(app)
        attach(app, "04 Completed and uploaded")
        activate(app.buttons["Uncomplete \(edited)"])
        XCTAssertTrue(task(edited, app).waitForNonExistence(timeout: 20))
        #if os(iOS)
            app.tabBars.buttons["Inbox"].tap()
        #else
            activate(app.buttons["Inbox"])
        #endif
        XCTAssertTrue(task(edited, app).waitForExistence(timeout: 20))
        app.terminate()
        app.launch()
        XCTAssertTrue(task(edited, app).waitForExistence(timeout: 30))
        waitUntilSynced(app)
        attach(app, "05 Reopened and synced after cold relaunch")
    }

    private func waitUntilSynced(_ app: XCUIApplication) {
        waitUntilPhase("synced", app)
    }

    private func waitUntilPhase(_ phase: String, _ app: XCUIApplication) {
        let status = app.descendants(matching: .any)["facet.sync.status"].firstMatch
        let settled = NSPredicate(format: "exists == true AND value == %@", phase)
        XCTAssertEqual(
            XCTWaiter.wait(
                for: [XCTNSPredicateExpectation(predicate: settled, object: status)], timeout: 120),
            .completed, "The real transport did not reach the required phase: \(phase).")
    }

    private func task(_ title: String, _ app: XCUIApplication) -> XCUIElement {
        #if os(macOS)
            app.staticTexts.matching(NSPredicate(format: "label == %@", title)).firstMatch
        #else
            app.buttons.matching(NSPredicate(format: "label == %@", title)).firstMatch
        #endif
    }

    private func activate(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: 10))
        #if os(macOS)
            element.click()
        #else
            element.tap()
        #endif
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let forbidden = [
            "facet.account.email", "facet.account.password", "facet.account.code",
            "facet.account.vault-password", "facet.account.signin", "facet.account.error",
        ]
        guard app.buttons["facet.capture.open"].exists, app.alerts.count == 0,
            !forbidden.contains(where: { app.descendants(matching: .any)[$0].firstMatch.exists })
        else {
            XCTFail("Screenshot requires the synthetic workspace without account entry or errors.")
            return
        }
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

private struct LiveDescriptor: Decodable {
    let schemaVersion: Int
    let runID: UUID
    let allowedRemoteVaultID: String?
}

private enum LiveLaunchError: Error { case invalidOwnership }
