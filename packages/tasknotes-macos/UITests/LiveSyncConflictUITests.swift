import Foundation
import XCTest

/// These journeys require a harness-owned encrypted remote vault. They neither
/// enter account credentials nor substitute a transport or a local test server.
@MainActor
final class LiveSyncConflictUITests: XCTestCase {
    private struct Descriptor: Decodable {
        let schemaVersion: UInt32
        let runID: UUID
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

    func testEditOwnedTaskWhileOffline() throws {
        let scenario = try scenario()
        let app = launch(scenario)
        let status = app.descendants(matching: .any)["facet.sync.status"].firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 20))
        XCTAssertEqual(
            status.value as? String, "offline", "Interrupt the owned session before this journey.")
        let existingTask = task(scenario.originalTitle, app: app)
        XCTAssertTrue(existingTask.waitForExistence(timeout: 20))
        activate(existingTask)
        #if os(macOS)
            let title = app.textFields["facet.inspector.title"]
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
        XCTAssertTrue(task(scenario.localTitle, app: app).waitForExistence(timeout: 15))
        attach(app, name: "Live owned vault local conflict edit while offline")
        app.terminate()
    }

    func testPreviewAndKeepBothVersions() throws {
        let scenario = try scenario()
        let app = launch(scenario)
        let open = app.buttons["facet.conflicts.open"]
        XCTAssertTrue(
            open.waitForExistence(timeout: 30),
            "Resume the session and wait for its durable conflict first.")
        activate(open)
        let local = app.buttons.matching(identifier: "facet.conflict.preview.local")
        let remote = app.buttons.matching(identifier: "facet.conflict.preview.remote")
        XCTAssertTrue(local.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(local.count, 1)
        XCTAssertEqual(remote.count, 1)
        assertPreview(
            scenario.localTitle, excludes: scenario.remoteTitle, button: local.firstMatch, app: app)
        assertPreview(
            scenario.remoteTitle, excludes: scenario.localTitle, button: remote.firstMatch, app: app
        )
        let keep = app.buttons.matching(identifier: "facet.conflict.keepBoth")
        XCTAssertEqual(keep.count, 1)
        activate(keep.firstMatch)
        let destination = app.textFields["facet.conflict.destination"]
        XCTAssertTrue(destination.waitForExistence(timeout: 5))
        XCTAssertEqual(destination.value as? String, "")
        activate(destination)
        destination.typeText(scenario.destination)
        XCTAssertEqual(destination.value as? String, scenario.destination)
        attach(app, name: "Live owned vault keep both original conflict versions")
        activate(app.buttons["facet.conflict.save"])
        XCTAssertTrue(destination.waitForNonExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["All conflicts are resolved."].waitForExistence(timeout: 15))
        attach(app, name: "Live owned vault conflict resolution applied")
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

    private func launch(_ scenario: Scenario) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--facet-acceptance-descriptor", scenario.descriptor]
        #if !os(macOS)
            app.launchEnvironment["FACET_E2E_SIMULATOR"] =
                ProcessInfo.processInfo.environment["FACET_E2E_SIMULATOR"]
        #endif
        app.launch()
        addTeardownBlock { @MainActor in app.terminate() }
        return app
    }

    private func task(_ title: String, app: XCUIApplication) -> XCUIElement {
        #if os(macOS)
            app.staticTexts.matching(NSPredicate(format: "label == %@", title)).firstMatch
        #else
            app.buttons.matching(NSPredicate(format: "label == %@", title)).firstMatch
        #endif
    }

    private func assertPreview(
        _ expected: String, excludes: String, button: XCUIElement, app: XCUIApplication
    ) {
        activate(button)
        let preview = app.staticTexts["facet.conflict.preview.text"]
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        let contents = preview.label
        XCTAssertTrue(contents.contains(expected))
        XCTAssertFalse(contents.contains(excludes))
        XCTAssertTrue(contents.contains("Live Sync preservation sentinel."))
        attach(app, name: "Live owned vault retained version \(expected)")
        activate(app.buttons["facet.conflict.preview.done"])
        XCTAssertTrue(preview.waitForNonExistence(timeout: 5))
    }

    private func activate(_ element: XCUIElement) {
        #if os(macOS)
            element.click()
        #else
            element.tap()
        #endif
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = name
        evidence.lifetime = .keepAlways
        add(evidence)
    }
}
