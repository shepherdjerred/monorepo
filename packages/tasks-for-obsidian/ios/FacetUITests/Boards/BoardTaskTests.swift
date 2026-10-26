import Foundation
import XCTest

/// The separate board runner owns this simulator and preserves every fixture byte.
@MainActor
final class BoardTaskTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        XCTAssertNotNil(environment["FACET_E2E_SIMULATOR"])
        XCTAssertEqual(environment["FACET_E2E_SIMULATOR"], environment["SIMULATOR_UDID"])
        addUIInterruptionMonitor(withDescription: "Unexpected board acceptance interruption") { _ in
            XCTFail("The synthetic board journey was interrupted. No alert was accepted.")
            return false
        }
    }

    func testLowerLoadedCardScrollsWithinItsWorkflowColumn() throws {
        let app = try launchBoard()
        assertCount("100 of 120 tasks loaded", in: app)
        let open = element("facet.board.cards.open", in: app)
        let doing = element("facet.board.cards.doing", in: app)
        XCTAssertTrue(open.exists, app.debugDescription)
        XCTAssertTrue(doing.exists, app.debugDescription)
        let firstDoing = card("002", in: app)
        XCTAssertTrue(firstDoing.exists, app.debugDescription)
        let originalDoingFrame = firstDoing.frame
        reveal("095", in: open, app: app)
        XCTAssertTrue(firstDoing.exists, app.debugDescription)
        XCTAssertEqual(firstDoing.frame, originalDoingFrame, "Scrolling Open must not scroll Doing")
        assertCount("100 of 120 tasks loaded", in: app)
        attach(app, name: "02 Lower card remains reachable within the first hundred")
        openAndCancel("095", in: app)
        try stop(app)
    }

    func testLoadMoreMakesCardBeyondTheInitialHundredReachable() throws {
        let app = try launchBoard()
        assertCount("100 of 120 tasks loaded", in: app)
        XCTAssertFalse(card("119", in: app).exists)
        tapReady(app.buttons["facet.board.loadMore"])
        assertCount("120 of 120 tasks loaded", in: app)
        XCTAssertTrue(app.buttons["facet.board.loadMore"].waitForNonExistence(timeout: 10))
        attach(app, name: "03 Native board pagination loads all hundred twenty tasks")
        reveal("119", in: element("facet.board.cards.open", in: app), app: app)
        attach(app, name: "04 Card beyond the initial hundred becomes reachable")
        openAndCancel("119", in: app)
        try stop(app)
    }

    private func launchBoard() throws -> XCUIApplication {
        try requireViewer()
        let app = XCUIApplication()
        app.launchEnvironment["FACET_E2E_SIMULATOR"] =
            ProcessInfo.processInfo.environment["FACET_E2E_SIMULATOR"]
        app.launchArguments = ["--facet-native-acceptance"]
        app.launch()
        addTeardownBlock { @MainActor in app.terminate() }
        let browse = app.tabBars.buttons["Browse"]
        XCTAssertTrue(browse.waitForExistence(timeout: 20))
        tapReady(browse)
        if !browse.isSelected {
            let selected = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "selected == true"), object: browse)
            XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 10), .completed)
        }
        XCTAssertTrue(browse.isSelected, app.debugDescription)
        requireReady(app.navigationBars["Browse"].staticTexts["Browse"])
        let view = app.buttons.matching(
            NSPredicate(format: "label CONTAINS %@", "Board acceptance")
        ).firstMatch
        for _ in 0..<6 {
            if view.exists && view.isHittable { break }
            app.swipeUp()
        }
        tapReady(view)
        requireReady(app.navigationBars["Board acceptance"].staticTexts["Board acceptance"])
        assertCount("100 of 120 tasks loaded", in: app)
        attach(app, name: "01 Board opens two active workflow columns with bounded initial page")
        return app
    }

    private func reveal(_ number: String, in column: XCUIElement, app: XCUIApplication) {
        requireReady(column)
        let target = card(number, in: app)
        for _ in 0..<24 {
            if target.exists && target.isHittable && column.frame.contains(target.frame) { break }
            column.swipeUp()
        }
        requireReady(target)
        XCTAssertTrue(column.frame.contains(target.frame), app.debugDescription)
    }

    private func openAndCancel(_ number: String, in app: XCUIApplication) {
        tapReady(card(number, in: app))
        let title = app.textFields["facet.editor.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(title.value as? String, "Board card \(number)", app.debugDescription)
        attach(app, name: "05 Actual editor opens card \(number) without changing it")
        tapReady(app.buttons["Cancel"])
        XCTAssertTrue(title.waitForNonExistence(timeout: 10))
    }

    private func assertCount(_ label: String, in app: XCUIApplication) {
        let count = element("facet.board.loadedCount", in: app)
        XCTAssertTrue(count.waitForExistence(timeout: 10), app.debugDescription)
        let expected = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", label), object: count)
        if count.label != label {
            XCTAssertEqual(XCTWaiter.wait(for: [expected], timeout: 10), .completed)
        }
        XCTAssertEqual(count.label, label, app.debugDescription)
        XCTAssertTrue(count.isHittable, app.debugDescription)
    }

    private func requireReady(_ control: XCUIElement) {
        if !control.exists { XCTAssertTrue(control.waitForExistence(timeout: 10)) }
        if !control.isEnabled || !control.isHittable {
            let ready = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "enabled == true AND hittable == true"),
                object: control)
            XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed)
        }
        XCTAssertTrue(control.exists)
        XCTAssertTrue(control.isEnabled)
        XCTAssertTrue(control.isHittable)
    }

    private func tapReady(_ control: XCUIElement) {
        requireReady(control)
        control.tap()
    }

    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func card(_ number: String, in app: XCUIApplication) -> XCUIElement {
        element("facet.task.Tasks/Card-\(number).md", in: app)
            .buttons.containing(.staticText, identifier: "Board card \(number)").firstMatch
    }

    private func requireViewer() throws {
        let environment = ProcessInfo.processInfo.environment
        let day = try XCTUnwrap(environment["FACET_BOARD_DAY"])
        let zone = try XCTUnwrap(environment["FACET_BOARD_TIME_ZONE"])
        XCTAssertEqual(TimeZone.current.identifier, zone)
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        XCTAssertEqual(formatter.string(from: Date()), day, "Real viewer day changed")
    }

    private func stop(_ app: XCUIApplication) throws {
        try requireViewer()
        app.terminate()
        XCTAssertEqual(app.state, .notRunning)
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let environment = ProcessInfo.processInfo.environment
        guard let owned = environment["FACET_E2E_SIMULATOR"],
            owned == environment["SIMULATOR_UDID"], app.state == .runningForeground
        else {
            XCTFail("Board captures require the foreground app on the owned simulator.")
            return
        }
        XCTAssertEqual(app.alerts.count, 0)
        XCTAssertEqual(app.secureTextFields.count, 0)
        for identifier in [
            "facet.account.email", "facet.account.password", "facet.account.code",
            "facet.account.vault-password",
        ] {
            XCTAssertFalse(element(identifier, in: app).exists)
        }
        for (suffix, screenshot) in [
            ("app", app.screenshot()), ("owned simulator", XCUIScreen.main.screenshot()),
        ] {
            let image = XCTAttachment(screenshot: screenshot)
            image.name = name + " [\(suffix)]"
            image.lifetime = .keepAlways
            add(image)
        }
    }
}
