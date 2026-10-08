import Foundation
import XCTest

@MainActor
final class StandaloneVaultUITests: XCTestCase {
    func testNativeVaultCaptureEditAndRelaunch() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--facet-native-acceptance"]
        app.launch()
        let capture = app.buttons["facet.capture.open"]
        XCTAssertTrue(capture.waitForExistence(timeout: 20))
        capture.click()
        let title = "Native Mac " + UUID().uuidString
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
        let editor = app.textFields["facet.editor.title"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.click()
        editor.typeKey("a", modifierFlags: .command)
        let edited = title + " edited"
        editor.typeText(edited)
        app.buttons["facet.editor.save"].click()
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
