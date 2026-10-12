import Foundation
import XCTest

/// These journeys require a harness-owned encrypted remote vault. They neither
/// enter account credentials nor substitute a transport or a local test server.
@MainActor
final class LiveSyncConflictUITests: XCTestCase {
    private struct Descriptor: Decodable {
        let schemaVersion: UInt32
        let runID: UUID
        let stateDirectory: String
        let allowedRemoteVaultID: String?
    }
    private struct Scenario {
        let descriptor: String
        let caseID: UUID
        let originalTitle: String
        var localTitle: String { "Facet local conflict \(caseID.uuidString.lowercased())" }
        var remoteTitle: String { "Facet remote conflict \(caseID.uuidString.lowercased())" }
        var destination: String { "Tasks/Conflict \(caseID.uuidString.lowercased()).md" }
    }
    private enum OwnershipError: Error { case descriptor, application, simulator }

    override func setUp() { continueAfterFailure = false }

    func testEditOwnedTaskWhileOffline() async throws {
        let scenario = try scenario()
        let (app, surface) = try launch(scenario)
        #if os(macOS)
            let status = surface.descendants(matching: .any).matching(
                identifier: "facet.sync.status"
            ).element
        #else
            let status = app.descendants(matching: .any)["facet.sync.status"].firstMatch
        #endif
        XCTAssertTrue(status.waitForExistence(timeout: 20))
        XCTAssertEqual(
            status.value as? String, "offline", "Interrupt the owned session before this journey.")
        let existingTask = task(scenario.originalTitle, surface: surface)
        XCTAssertTrue(existingTask.waitForExistence(timeout: 20))
        activate(existingTask)
        #if os(macOS)
            let title = surface.textFields["facet.inspector.title"]
            XCTAssertTrue(title.waitForExistence(timeout: 5))
            title.click()
            title.typeKey("a", modifierFlags: .command)
            title.typeText(scenario.localTitle)
            XCTAssertEqual(title.value as? String, scenario.localTitle)
            title.typeKey(.return, modifierFlags: [])
        #else
            let title = app.textFields["facet.editor.title"]
            XCTAssertTrue(title.waitForExistence(timeout: 5))
            title.tap()
            title.press(forDuration: 1.1)
            let selectAll = app.descendants(matching: .any).matching(
                NSPredicate(format: "label == %@", "Select All")
            ).firstMatch
            XCTAssertTrue(selectAll.waitForExistence(timeout: 5))
            selectAll.tap()
            title.typeText(scenario.localTitle)
            XCTAssertEqual(title.value as? String, scenario.localTitle)
            app.buttons["facet.editor.save"].tap()
        #endif
        XCTAssertTrue(task(scenario.localTitle, surface: surface).waitForExistence(timeout: 15))
        try await attach(
            app, surface: surface, name: "Live owned vault local conflict edit while offline")
        app.terminate()
    }

    func testPreviewAndKeepBothVersions() async throws {
        let scenario = try scenario()
        let (app, surface) = try launch(scenario)
        #if os(macOS)
            let other = try secondWorkspace(app: app, surface: surface)
        #endif
        let open = surface.buttons["facet.conflicts.open"]
        XCTAssertTrue(
            open.waitForExistence(timeout: 30),
            "Resume the session and wait for its durable conflict first.")
        activate(open)
        #if os(macOS)
            assertConflictSheetOwnership(app: app, surface: surface, nonowner: other)
        #endif
        let local = surface.buttons.matching(identifier: "facet.conflict.preview.local")
        let remote = surface.buttons.matching(identifier: "facet.conflict.preview.remote")
        XCTAssertTrue(local.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(local.count, 1)
        XCTAssertEqual(remote.count, 1)
        try await assertPreview(
            scenario.localTitle, excludes: scenario.remoteTitle, button: local.firstMatch, app: app,
            surface: surface)
        try await assertPreview(
            scenario.remoteTitle, excludes: scenario.localTitle, button: remote.firstMatch,
            app: app,
            surface: surface
        )
        let keep = surface.buttons.matching(identifier: "facet.conflict.keepBoth")
        XCTAssertEqual(keep.count, 1)
        activate(keep.firstMatch)
        let destination = surface.textFields["facet.conflict.destination"]
        XCTAssertTrue(destination.waitForExistence(timeout: 5))
        XCTAssertEqual(destination.value as? String, "")
        activate(destination)
        destination.typeText(scenario.destination)
        XCTAssertEqual(destination.value as? String, scenario.destination)
        try await attach(
            app, surface: surface, name: "Live owned vault keep both original conflict versions")
        activate(surface.buttons["facet.conflict.save"])
        XCTAssertTrue(destination.waitForNonExistence(timeout: 15))
        #if os(macOS)
            let resolved = surface.staticTexts.matching(
                NSPredicate(format: "value == %@", "All conflicts are resolved.")
            ).element
        #else
            let resolved = app.staticTexts["All conflicts are resolved."]
        #endif
        XCTAssertTrue(resolved.waitForExistence(timeout: 15))
        try await attach(
            app, surface: surface, name: "Live owned vault conflict resolution applied")
        app.terminate()
    }

    private func scenario() throws -> Scenario {
        let environment = ProcessInfo.processInfo.environment
        let descriptor = try XCTUnwrap(environment["FACET_E2E_DESCRIPTOR"])
        let runID = try XCTUnwrap(environment["FACET_E2E_RUN_ID"].flatMap(UUID.init(uuidString:)))
        let vaultID = try XCTUnwrap(environment["FACET_E2E_REMOTE_VAULT_ID"])
        let caseID = try XCTUnwrap(
            environment["FACET_E2E_CONFLICT_CASE_ID"].flatMap(UUID.init(uuidString:)))
        let originalTitle = try XCTUnwrap(environment["FACET_E2E_CONFLICT_ORIGINAL_TITLE"])
        XCTAssertFalse(vaultID.isEmpty)
        #if os(iOS)
            guard descriptor == "@documents/acceptance.json" else {
                throw OwnershipError.descriptor
            }
            let descriptorJSON = try XCTUnwrap(environment["FACET_E2E_DESCRIPTOR_JSON"])
            let descriptorBytes = Data(descriptorJSON.utf8)
        #else
            guard descriptor.hasPrefix("/") else { throw OwnershipError.descriptor }
            let descriptorBytes = try Data(contentsOf: URL(fileURLWithPath: descriptor))
        #endif
        let contract = try JSONDecoder().decode(
            Descriptor.self, from: descriptorBytes)
        #if os(macOS)
            _ = try MacAcceptanceOwnership.validate(
                descriptor: descriptor, stateDirectory: contract.stateDirectory, runID: runID)
        #endif
        guard contract.schemaVersion == 1, contract.runID == runID,
            contract.allowedRemoteVaultID == vaultID, !vaultID.isEmpty
        else { throw OwnershipError.descriptor }
        #if os(macOS)
            guard environment["FACET_E2E_APP_BUNDLE_ID"] == "red.sjer.tasknotes.mac.acceptance"
            else { throw OwnershipError.application }
        #else
            let device = try XCTUnwrap(environment["FACET_E2E_SIMULATOR"])
            guard UUID(uuidString: device) != nil, device == environment["SIMULATOR_UDID"]
            else { throw OwnershipError.simulator }
        #endif
        return Scenario(descriptor: descriptor, caseID: caseID, originalTitle: originalTitle)
    }

    private func launch(_ scenario: Scenario) throws -> (XCUIApplication, XCUIElement) {
        let app = XCUIApplication()
        app.launchArguments = ["--facet-acceptance-descriptor", scenario.descriptor]
        #if !os(macOS)
            app.launchEnvironment["FACET_E2E_SIMULATOR"] =
                ProcessInfo.processInfo.environment["FACET_E2E_SIMULATOR"]
        #endif
        app.launch()
        addTeardownBlock { @MainActor in app.terminate() }
        #if os(macOS)
            return (app, try MacAcceptanceWorkspace.initial(app: app))
        #else
            return (app, app)
        #endif
    }

    private func task(_ title: String, surface: XCUIElement) -> XCUIElement {
        #if os(macOS)
            surface.staticTexts.matching(NSPredicate(format: "value == %@", title)).element
        #else
            surface.buttons.matching(NSPredicate(format: "label == %@", title)).firstMatch
        #endif
    }

    private func assertPreview(
        _ expected: String, excludes: String, button: XCUIElement, app: XCUIApplication,
        surface: XCUIElement
    ) async throws {
        activate(button)
        let preview = surface.staticTexts["facet.conflict.preview.text"]
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        #if os(macOS)
            let contents = try XCTUnwrap(preview.value as? String)
        #else
            let contents = preview.label
        #endif
        XCTAssertTrue(contents.contains(expected))
        XCTAssertFalse(contents.contains(excludes))
        XCTAssertTrue(contents.contains("Live Sync preservation sentinel."))
        try await attach(
            app, surface: surface, name: "Live owned vault retained version \(expected)")
        activate(surface.buttons["facet.conflict.preview.done"])
        XCTAssertTrue(preview.waitForNonExistence(timeout: 5))
    }

    private func activate(_ element: XCUIElement) {
        #if os(macOS)
            element.click()
        #else
            element.tap()
        #endif
    }

    private func attach(_ app: XCUIApplication, surface: XCUIElement, name: String) async throws {
        #if os(macOS)
            try await MacAcceptanceCapture.attach(
                app: app, name: name, test: self, windows: [surface])
        #else
            let evidence = XCTAttachment(screenshot: app.screenshot())
            evidence.name = name
            evidence.lifetime = .keepAlways
            add(evidence)
        #endif
    }
}

#if os(macOS)
    extension LiveSyncConflictUITests {
        private func secondWorkspace(app: XCUIApplication, surface: XCUIElement) throws
            -> XCUIElement
        {
            let other = try MacAcceptanceWorkspace.create(app: app)
            XCTAssertNotEqual(surface.identifier, other.identifier)
            XCTAssertEqual(
                app.windows.matching(
                    NSPredicate(format: "identifier BEGINSWITH %@", "facet.workspace.")
                ).count, 2)
            XCTAssertEqual(other.sheets.count, 0)
            return other
        }

        private func assertConflictSheetOwnership(
            app: XCUIApplication, surface: XCUIElement, nonowner: XCUIElement
        ) {
            XCTAssertTrue(surface.sheets.element.waitForExistence(timeout: 10))
            XCTAssertEqual(surface.sheets.count, 1)
            XCTAssertTrue(nonowner.exists)
            XCTAssertEqual(nonowner.sheets.count, 0)
            for other in app.windows.matching(
                NSPredicate(format: "identifier BEGINSWITH %@", "facet.workspace.")
            ).allElementsBoundByIndex where other.identifier != surface.identifier {
                XCTAssertEqual(
                    other.sheets.count, 0, "Conflict inbox must belong to the requesting workspace."
                )
            }
        }
    }
#endif
