import Foundation
import XCTest

@MainActor
final class StandaloneVaultUITests: XCTestCase {
    func testNativeVaultCaptureEditAndRelaunch() throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        let descriptor = try XCTUnwrap(
            environment["FACET_E2E_DESCRIPTOR"],
            "Run the isolated TaskNotesAcceptance scheme with a runner-owned descriptor.")
        let runID = try XCTUnwrap(environment["FACET_E2E_RUN_ID"].flatMap(UUID.init(uuidString:)))
        let bytes = try Data(contentsOf: URL(fileURLWithPath: descriptor))
        let configuration = try JSONDecoder().decode(AcceptanceDescriptor.self, from: bytes)
        guard descriptor.hasPrefix("/"), configuration.schemaVersion == 1,
            configuration.runID == runID, configuration.allowedRemoteVaultID == nil
        else { throw LocalAcceptanceLaunchError.invalidOwnership }
        let app = XCUIApplication(bundleIdentifier: "red.sjer.tasknotes.mac.acceptance")
        addTeardownBlock { @MainActor in app.terminate() }
        app.launchArguments = [
            "--facet-acceptance-descriptor", descriptor, "--facet-native-acceptance",
        ]
        app.launch()
        let capture = app.buttons["facet.capture.open"]
        XCTAssertTrue(capture.waitForExistence(timeout: 20))
        capture.click()
        let title = "Native Mac " + runID.uuidString.lowercased()
        let field = app.textFields["facet.capture.title"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.click()
        field.typeText(title)
        app.buttons["facet.capture.submit"].click()
        let captured = XCTAttachment(screenshot: app.screenshot())
        captured.name = "Standalone Mac after capture"
        captured.lifetime = .keepAlways
        add(captured)
        let task = app.staticTexts[title].firstMatch
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        task.click()
        let editor = app.textFields["facet.inspector.title"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.click()
        editor.typeKey("a", modifierFlags: .command)
        let edited = title + " edited"
        editor.typeText(edited)
        editor.typeKey(.return, modifierFlags: [])
        let saved = app.staticTexts[edited].firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        XCTAssertTrue(saved.waitForExistence(timeout: 20))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Standalone Mac capture edit relaunch"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

private struct AcceptanceDescriptor: Decodable {
    let schemaVersion: Int
    let runID: UUID
    let allowedRemoteVaultID: String?
}

private enum LocalAcceptanceLaunchError: Error { case invalidOwnership }
