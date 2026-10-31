import Foundation
import XCTest

/// Only the first-use slide-typing introduction on the harness-owned simulator.
/// Unknown interruptions remain the individual journey's failing responsibility.
@MainActor
enum FacetKeyboardBootstrap {
    private static let explanation =
        "Speed up your typing by sliding your finger across the letters to compose a word."

    static func focus(_ field: XCUIElement, in app: XCUIApplication) {
        field.tap()
        dismissIfPresent(in: app)
    }

    static func typeText(_ text: String, into field: XCUIElement, in app: XCUIApplication) {
        field.typeText(text)
        dismissIfPresent(in: app)
    }

    @discardableResult
    static func dismissIfPresent(in container: XCUIElement) -> Bool {
        let introduction = container.staticTexts[explanation]
        guard introduction.exists else { return false }
        let environment = ProcessInfo.processInfo.environment
        guard let owned = environment["FACET_E2E_SIMULATOR"],
            owned == environment["SIMULATOR_UDID"]
        else {
            XCTFail("Keyboard bootstrap is restricted to the harness-owned simulator.")
            return false
        }
        let deadline = Date().addingTimeInterval(2)
        let button = container.buttons["Continue"]
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND hittable == true"), object: button)
        guard XCTWaiter.wait(for: [ready], timeout: 2) == .completed else {
            XCTFail(
                "The known keyboard introduction has no hittable Continue button.\n\(container)")
            return false
        }
        button.tap()
        XCTAssertTrue(
            introduction.waitForNonExistence(timeout: max(0, deadline.timeIntervalSinceNow)),
            "The known keyboard introduction did not dismiss.\n\(container)")
        return true
    }
}
