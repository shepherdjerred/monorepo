import XCTest

final class StandaloneTaskTests: XCTestCase {
    @MainActor
    func testCompactFiltersRemainUsableAtAccessibilityTextSize() {
        let app = XCUIApplication()
        app.launchArguments = ["--facet-native-acceptance", "--facet-accessibility-size"]
        app.launch()
        let filters = app.buttons["Filters"]
        XCTAssertTrue(filters.waitForExistence(timeout: 20))
        XCTAssertTrue(filters.isHittable)
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = "Compact filters at accessibility text size"
        evidence.lifetime = .keepAlways
        add(evidence)
        filters.tap()
        XCTAssertTrue(app.buttons["Include archived tasks"].waitForExistence(timeout: 5))
    }
    @MainActor
    func testCaptureEditAndRelaunchUseTheLocalVault() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--facet-native-acceptance"]
        app.launch()
        let captureButton = app.buttons["facet.capture.open"]
        XCTAssertTrue(captureButton.waitForExistence(timeout: 20))
        captureButton.tap()
        let capture = app.textFields["facet.capture.title"]
        XCTAssertTrue(capture.waitForExistence(timeout: 5))
        let title = "Created on iOS \(UUID().uuidString.prefix(8))"
        capture.tap(); capture.typeText(title)
        app.buttons["facet.capture.submit"].tap()
        let created = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(created.waitForExistence(timeout: 10))
        created.tap()
        let editor = app.textFields["facet.editor.title"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: title.count))
        let edited = "Edited on iOS \(UUID().uuidString.prefix(8))"
        editor.typeText(edited)
        app.buttons["facet.editor.save"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", edited)).firstMatch.waitForExistence(timeout: 10))
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", edited)).firstMatch.waitForExistence(timeout: 20))
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = "Standalone capture edit and relaunch"
        evidence.lifetime = .keepAlways
        add(evidence)
    }
}
