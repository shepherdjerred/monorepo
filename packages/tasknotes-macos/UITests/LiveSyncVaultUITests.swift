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

    func testInitialDownloadUsesTaskNotesConfiguration() async throws {
        let title = try XCTUnwrap(
            ProcessInfo.processInfo.environment["FACET_E2E_INITIAL_TASK_TITLE"])
        guard !title.isEmpty, title.utf8.count <= 512,
            !title.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw LiveLaunchError.invalidOwnership }
        let journey = try launchJourney(prefix: "Initial")
        let app = journey.app
        let surface = journey.surface
        waitUntilSynced(surface)
        #if os(iOS)
            activate(app.tabBars.buttons["Inbox"])
        #else
            activate(surface.buttons["Inbox"])
        #endif
        XCTAssertTrue(task(title, surface).waitForExistence(timeout: 30))
        #if os(macOS)
            let tasks = surface.staticTexts.matching(NSPredicate(format: "value == %@", title))
        #else
            let tasks = app.buttons.matching(NSPredicate(format: "label == %@", title))
        #endif
        XCTAssertEqual(tasks.count, 1, "The configured initial task must appear exactly once.")
        let capture = surface.buttons["facet.capture.open"]
        XCTAssertTrue(capture.waitForExistence(timeout: 10))
        XCTAssertTrue(capture.isEnabled, "The configured vault must make native capture available.")
        XCTAssertFalse(surface.buttons["Use standard configuration"].exists)
        assertNoSetupWarnings(surface)
        try await attach(
            app, surface: surface, "Initial download displays the configured existing task")
    }

    func testCaptureEditCompleteUncompleteAndColdRelaunch() async throws {
        let journey = try launchJourney(prefix: "Live")
        let app = journey.app
        let initialSurface = journey.surface
        let title = journey.title
        waitUntilSynced(initialSurface)
        try await attach(app, surface: initialSurface, "01 Authenticated and synced")
        let edited = try await captureAndEdit(title: title, app: app, surface: initialSurface)
        app.terminate()
        app.launch()
        let surface = try workspace(app)
        XCTAssertTrue(task(edited, surface).waitForExistence(timeout: 30))
        waitUntilSynced(surface)
        try await attach(app, surface: surface, "03 Edit survives cold relaunch")
        try await completeAndReopen(edited: edited, app: app, surface: surface)
    }

    func testOfflineCaptureEditAndColdRelaunchRetainPendingChanges() async throws {
        let prefix = ProcessInfo.processInfo.environment["FACET_E2E_CAPTURE_PREFIX"] ?? "Offline"
        guard ["Offline", "Lifecycle"].contains(prefix) else {
            throw LiveLaunchError.invalidOwnership
        }
        let journey = try launchJourney(prefix: prefix)
        let app = journey.app
        let initialSurface = journey.surface
        let title = journey.title
        waitUntilPhase("offline", initialSurface)
        let edited = try await captureAndEdit(
            title: title, app: app, surface: initialSurface, offline: true)
        waitUntilPhase("offline", initialSurface)
        try await attach(app, surface: initialSurface, "01 Offline capture and edit retained")
        app.terminate()
        app.launch()
        let surface = try workspace(app)
        XCTAssertTrue(task(edited, surface).waitForExistence(timeout: 30))
        waitUntilPhase("offline", surface)
        try await attach(app, surface: surface, "02 Pending changes survive cold relaunch offline")
    }
}

extension LiveSyncVaultUITests {
    private func launchJourney(prefix: String) throws -> LiveVaultJourney {
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
        return LiveVaultJourney(
            app: app, surface: try workspace(app),
            title: "\(prefix) \(platform) \(runID.uuidString.lowercased())-\(round)")
    }

    private func workspace(_ app: XCUIApplication) throws -> XCUIElement {
        #if os(macOS)
            try MacAcceptanceWorkspace.initial(app: app)
        #else
            app
        #endif
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
        #if os(macOS)
            _ = try MacAcceptanceOwnership.validate(
                descriptor: path, stateDirectory: configuration.stateDirectory, runID: runID)
        #endif
        guard configuration.schemaVersion == 1, configuration.runID == runID,
            configuration.allowedRemoteVaultID == vaultID
        else { throw LiveLaunchError.invalidOwnership }
    }

    private func captureAndEdit(
        title: String, app: XCUIApplication, surface: XCUIElement, offline: Bool = false
    ) async throws -> String {
        activate(surface.buttons["facet.capture.open"])
        let capture = surface.textFields["facet.capture.title"]
        XCTAssertTrue(capture.waitForExistence(timeout: 10))
        activate(capture)
        capture.typeText(title)
        activate(surface.buttons["facet.capture.submit"])
        let created = task(title, surface)
        XCTAssertTrue(created.waitForExistence(timeout: 20))
        if offline {
            waitUntilPhase("offline", surface)
            try await attach(app, surface: surface, "Captured locally while offline")
        } else {
            waitUntilSynced(surface)
            try await attach(app, surface: surface, "02 Captured and uploaded")
        }
        activate(created)
        #if os(macOS)
            let editor = surface.textFields["facet.inspector.title"]
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
        XCTAssertTrue(task(edited, surface).waitForExistence(timeout: 20))
        return edited
    }

    private func completeAndReopen(edited: String, app: XCUIApplication, surface: XCUIElement)
        async throws
    {
        activate(surface.buttons["Complete \(edited)"])
        XCTAssertTrue(task(edited, surface).waitForNonExistence(timeout: 20))
        #if os(iOS)
            app.tabBars.buttons["Browse"].tap()
        #endif
        activate(surface.buttons["Completed"])
        XCTAssertTrue(task(edited, surface).waitForExistence(timeout: 20))
        waitUntilSynced(surface)
        try await attach(app, surface: surface, "04 Completed and uploaded")
        activate(surface.buttons["Uncomplete \(edited)"])
        XCTAssertTrue(task(edited, surface).waitForNonExistence(timeout: 20))
        #if os(iOS)
            app.tabBars.buttons["Inbox"].tap()
        #else
            activate(surface.buttons["Inbox"])
        #endif
        XCTAssertTrue(task(edited, surface).waitForExistence(timeout: 20))
        app.terminate()
        app.launch()
        let relaunched = try workspace(app)
        XCTAssertTrue(task(edited, relaunched).waitForExistence(timeout: 30))
        waitUntilSynced(relaunched)
        try await attach(app, surface: relaunched, "05 Reopened and synced after cold relaunch")
    }

    private func waitUntilSynced(_ app: XCUIElement) {
        waitUntilPhase("synced", app)
    }

    private func waitUntilPhase(_ phase: String, _ app: XCUIElement) {
        #if os(macOS)
            let status = app.descendants(matching: .any).matching(identifier: "facet.sync.status")
                .element
        #else
            let status = app.descendants(matching: .any)["facet.sync.status"].firstMatch
        #endif
        let settled = NSPredicate(format: "exists == true AND value == %@", phase)
        XCTAssertEqual(
            XCTWaiter.wait(
                for: [XCTNSPredicateExpectation(predicate: settled, object: status)], timeout: 120),
            .completed, "The real transport did not reach the required phase: \(phase).")
    }

    private func task(_ title: String, _ app: XCUIElement) -> XCUIElement {
        #if os(macOS)
            app.staticTexts.matching(NSPredicate(format: "value == %@", title)).element
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

    private func attach(_ app: XCUIApplication, surface: XCUIElement, _ name: String) async throws {
        let forbidden = [
            "facet.account.email", "facet.account.password", "facet.account.code",
            "facet.account.vault-password", "facet.account.signin", "facet.account.error",
        ]
        guard surface.buttons["facet.capture.open"].exists, app.alerts.count == 0,
            !forbidden.contains(where: { app.descendants(matching: .any)[$0].firstMatch.exists })
        else {
            XCTFail("Screenshot requires the synthetic workspace without account entry or errors.")
            return
        }
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

extension LiveSyncVaultUITests {
    private func assertNoSetupWarnings(_ app: XCUIElement) {
        let setupWarnings = app.staticTexts.matching(
            NSPredicate(
                format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@ OR label BEGINSWITH %@",
                "TaskNotes settings", ".obsidian/plugins/tasknotes/data.json:", "tasknotes.yaml:"))
        XCTAssertEqual(
            setupWarnings.count, 0,
            "Initial Sync must produce usable TaskNotes configuration without warnings or defaults consent."
        )
        #if os(macOS)
            let setupWarningValues = app.staticTexts.matching(
                NSPredicate(
                    format: "value CONTAINS[c] %@ OR value CONTAINS[c] %@ OR value BEGINSWITH %@",
                    "TaskNotes settings", ".obsidian/plugins/tasknotes/data.json:",
                    "tasknotes.yaml:"
                ))
            XCTAssertEqual(
                setupWarningValues.count, 0,
                "Initial Sync must expose no TaskNotes configuration warnings as native text values."
            )
        #endif
    }
}

private struct LiveDescriptor: Decodable {
    let schemaVersion: Int
    let runID: UUID
    let stateDirectory: String
    let allowedRemoteVaultID: String?
}

private struct LiveVaultJourney {
    let app: XCUIApplication
    let surface: XCUIElement
    let title: String
}

private enum LiveLaunchError: Error { case invalidOwnership }
