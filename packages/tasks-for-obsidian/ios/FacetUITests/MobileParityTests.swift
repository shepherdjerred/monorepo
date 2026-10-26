import Foundation
import XCTest

/// Selected only by ios-parity-acceptance.ts on its newly owned simulator.
/// Fixture dates follow the real viewer clock; the app receives no clock override.
@MainActor
final class MobileParityTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        XCTAssertNotNil(environment["FACET_E2E_SIMULATOR"])
        XCTAssertEqual(environment["FACET_E2E_SIMULATOR"], environment["SIMULATOR_UDID"])
        addUIInterruptionMonitor(withDescription: "Unexpected mobile parity interruption") { _ in
            XCTFail("The synthetic mobile journey was interrupted. No alert was accepted.")
            return false
        }
    }

    func testTodayUpcomingAndGlobalMetadataSearch() throws {
        let app = try launch()
        XCTAssertTrue(task("Parity reschedule task", in: app).waitForExistence(timeout: 20))
        XCTAssertFalse(task("Parity scoped metadata task", in: app).exists)
        attach(app, name: "01 Inbox keeps dated and contextual unprojected tasks")
        tab("Today", in: app)
        for (title, group) in [
            ("Parity overdue task", "overdue"), ("Parity planned today", "scheduled-today"),
            ("Parity due today", "due-today"),
        ] {
            reveal(task(title, in: app), in: app)
            XCTAssertTrue(app.staticTexts["facet.group.\(group)"].exists)
        }
        attach(app, name: "02 Today includes overdue planned and deadline sections")
        tab("Upcoming", in: app)
        assertUpcomingChrome(in: app)
        XCTAssertTrue(element("facet.upcoming.week", in: app).waitForExistence(timeout: 10))
        reveal(task("Parity distant future", in: app), in: app)
        attach(app, name: "03 Upcoming retains the task fourteen days away")
        tab("Inbox", in: app)
        tapEnabled(app.buttons["facet.search.open"])
        let search = app.searchFields["Search all tasks"]
        XCTAssertTrue(search.waitForExistence(timeout: 10), app.debugDescription)
        FacetKeyboardBootstrap.focus(search, in: app)
        FacetKeyboardBootstrap.typeText("parity-search-needle", into: search, in: app)
        XCTAssertEqual(search.value as? String, "parity-search-needle")
        let results = element("facet.search.results", in: app)
        XCTAssertTrue(results.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(
            task("Parity scoped metadata task", in: results).waitForExistence(timeout: 15),
            app.debugDescription)
        XCTAssertTrue(task("Parity scoped metadata task", in: results).isHittable)
        attach(app, name: "04 Global metadata search finds a task outside Inbox")
        let nonmatching = task("Parity reschedule task", in: results)
        XCTAssertTrue(nonmatching.waitForNonExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(nonmatching.exists, app.debugDescription)
        tapEnabled(app.buttons["facet.search.done"])
        try stop(app)
    }

    func testTodayCaptureAndQuickSchedulePersistAcrossColdLaunch() throws {
        let app = try launch()
        tab("Today", in: app)
        tapEnabled(app.buttons["facet.capture.open"])
        let title = app.textFields["facet.capture.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        FacetKeyboardBootstrap.focus(title, in: app)
        FacetKeyboardBootstrap.typeText("Parity captured sentinel", into: title, in: app)
        attach(app, name: "05 Today capture retains its planned-date chip")
        tapEnabled(app.buttons["facet.capture.submit"])
        XCTAssertTrue(title.waitForNonExistence(timeout: 10))
        reveal(task("Parity captured sentinel", in: app), in: app)
        try stop(app)
        app.launch()
        tab("Today", in: app)
        reveal(task("Parity captured sentinel", in: app), in: app)
        attach(app, name: "06 Today capture survives a cold launch")
        tab("Inbox", in: app)
        let row = element("facet.task.Tasks/Reschedule.md", in: app)
        revealSwipeActions(on: row, title: "Parity reschedule task", in: app)
        attach(app, name: "06b Partial swipe exposes task scheduling actions")
        tapEnabled(app.buttons["Schedule"])
        let tomorrow = app.buttons["facet.schedule.tomorrow"]
        XCTAssertTrue(tomorrow.waitForExistence(timeout: 10))
        let schedule = app.navigationBars["Schedule task"]
        XCTAssertTrue(schedule.exists, app.debugDescription)
        attach(app, name: "07 Native quick scheduling offers calendar and date shortcuts")
        tapEnabled(tomorrow)
        XCTAssertTrue(tomorrow.waitForNonExistence(timeout: 10))
        XCTAssertTrue(schedule.waitForNonExistence(timeout: 10), app.debugDescription)
        reveal(row, in: app)
        XCTAssertTrue(
            row.staticTexts["Date, Tomorrow"].waitForExistence(timeout: 10), app.debugDescription)
        try stop(app)
        app.launch()
        tab("Inbox", in: app)
        reveal(task("Parity reschedule task", in: app), in: app)
        XCTAssertTrue(
            row.staticTexts["Date, Tomorrow"].waitForExistence(timeout: 10), app.debugDescription)
        attach(app, name: "08 Scheduled task remains in Inbox after a cold launch")
        try stop(app)
    }

    func testFiltersSortSelectionAndSavedViewEditorRemainReachable() throws {
        let app = try launch()
        tapEnabled(app.buttons["facet.filters.open"])
        XCTAssertTrue(element("facet.query.completion", in: app).waitForExistence(timeout: 5))
        attach(app, name: "09 Native filters retain configuration-aware choices")
        reveal(element("facet.query.sortField", in: app), in: app)
        attach(app, name: "10 Filter editor retains sorting and grouping controls")
        tapEnabled(app.buttons["Cancel"])
        tapEnabled(app.buttons["facet.sort.open"])
        tapEnabled(app.buttons["Title"])
        tapEnabled(app.buttons["facet.selection.toggle"])
        let selected = app.buttons["facet.selection.task.Tasks/Reschedule.md"]
        reveal(selected, in: app)
        selected.tap()
        XCTAssertTrue(app.buttons["facet.selection.actions"].isEnabled)
        attach(app, name: "11 Touch selection exposes task actions")
        tapEnabled(app.buttons["facet.selection.toggle"])
        createSavedView(in: app)
        try stop(app)
    }
}

extension MobileParityTests {
    private func createSavedView(in app: XCUIApplication) {
        tab("Browse", in: app)
        let manage = app.buttons["Manage saved views"]
        reveal(manage, in: app)
        manage.tap()
        tapEnabled(app.buttons["Create saved view"])
        let name = app.textFields["facet.saved-view.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        FacetKeyboardBootstrap.focus(name, in: app)
        FacetKeyboardBootstrap.typeText("Parity saved view\n", into: name, in: app)
        XCTAssertEqual(name.value as? String, "Parity saved view", app.debugDescription)
        XCTAssertTrue(
            app.keyboards.firstMatch.waitForNonExistence(timeout: 5), app.debugDescription)
        let favorite = app.switches["Favorite"]
        reveal(favorite, in: app)
        enableNativeSwitch(favorite, in: app)
        attach(app, name: "12 Saved views retain name symbol color and favorite controls")
        configureSavedViewQuery(in: app)
        tapEnabled(app.buttons["facet.saved-view.save"])
        XCTAssertTrue(name.waitForNonExistence(timeout: 10))
        tapEnabled(app.buttons["Edit Parity saved view"])
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        XCTAssertEqual(name.value as? String, "Parity saved view")
        XCTAssertEqual(app.switches["Favorite"].value as? String, "1")
        attach(app, name: "14 Managing an existing view opens its own editor")
        tapEnabled(app.buttons["Cancel"])
        XCTAssertTrue(name.waitForNonExistence(timeout: 10))
        tapEnabled(app.buttons["Done"])
        let saved = app.buttons.matching(
            NSPredicate(format: "label CONTAINS %@", "Parity saved view")
        ).firstMatch
        reveal(saved, in: app)
        saved.tap()
        requireHittable(app.navigationBars["Parity saved view"].staticTexts["Parity saved view"])
        XCTAssertTrue(task("Parity scoped metadata task", in: app).waitForExistence(timeout: 15))
        XCTAssertFalse(task("Parity reschedule task", in: app).exists)
        assertFeedbackClearsCapture(in: app)
        attach(app, name: "15 Saved view opens its actual filtered task list")
    }

    private func configureSavedViewQuery(in app: XCUIApplication) {
        let tags = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Tags"))
            .firstMatch
        reveal(tags, in: app)
        tags.tap()
        let filter = app.switches["facet.query.tags.parity-search-needle"]
        reveal(filter, in: app)
        enableNativeSwitch(filter, in: app)
        let sort = element("facet.query.sortField", in: app)
        reveal(sort, in: app)
        sort.tap()
        let option = app.buttons["Title"].exists ? app.buttons["Title"] : app.staticTexts["Title"]
        tapEnabled(option)
        XCTAssertEqual(filter.value as? String, "1", app.debugDescription)
        attach(app, name: "13 Saved-view editor retains its own tag filter and sort")
    }

    private func enableNativeSwitch(_ control: XCUIElement, in app: XCUIApplication) {
        XCTAssertEqual(control.value as? String, "0", app.debugDescription)
        XCTAssertEqual(control.switches.count, 1, app.debugDescription)
        let thumb = control.switches.firstMatch
        tapEnabled(thumb)
        XCTAssertEqual(control.value as? String, "1", app.debugDescription)
        XCTAssertEqual(thumb.value as? String, "1", app.debugDescription)
    }

    private func launch() throws -> XCUIApplication {
        try requireViewer()
        let app = XCUIApplication()
        app.launchEnvironment["FACET_E2E_SIMULATOR"] =
            ProcessInfo.processInfo.environment["FACET_E2E_SIMULATOR"]
        app.launchArguments = ["--facet-native-acceptance"]
        app.launch()
        addTeardownBlock { @MainActor in app.terminate() }
        XCTAssertTrue(app.tabBars.buttons["Inbox"].waitForExistence(timeout: 20))
        attach(app, name: "00 Workspace ready before task lookup")
        return app
    }

    private func stop(_ app: XCUIApplication) throws {
        try requireViewer()
        app.terminate()
        XCTAssertEqual(app.state, .notRunning)
    }

    private func tab(_ title: String, in app: XCUIApplication) {
        let button = app.tabBars.buttons[title]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        button.tap()
    }

    private func task(_ title: String, in container: XCUIElement) -> XCUIElement {
        container.buttons.containing(.staticText, identifier: title).firstMatch
    }

    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func reveal(_ control: XCUIElement, in app: XCUIApplication) {
        _ = control.waitForExistence(timeout: 3)
        for _ in 0..<6 {
            if control.exists && control.isHittable { return }
            app.swipeUp()
        }
        XCTAssertTrue(control.exists && control.isHittable, app.debugDescription)
    }

    private func tapEnabled(_ control: XCUIElement) {
        requireHittable(control)
        control.tap()
    }

    private func revealSwipeActions(
        on row: XCUIElement, title: String, in app: XCUIApplication
    ) {
        let tabBar = app.tabBars.firstMatch
        let list = app.collectionViews.firstMatch
        let capture = app.buttons["facet.capture.open"]
        XCTAssertTrue(tabBar.exists, app.debugDescription)
        XCTAssertTrue(list.exists, app.debugDescription)
        XCTAssertTrue(capture.exists, app.debugDescription)
        _ = row.waitForExistence(timeout: 3)
        for _ in 0..<6 {
            if row.exists && row.isHittable && row.frame.minY >= list.frame.minY
                && row.frame.maxY <= min(list.frame.maxY, tabBar.frame.minY, capture.frame.minY)
            {
                break
            }
            app.swipeUp()
        }
        XCTAssertTrue(row.exists && row.isHittable, app.debugDescription)
        XCTAssertGreaterThanOrEqual(row.frame.minY, list.frame.minY, app.debugDescription)
        XCTAssertLessThanOrEqual(
            row.frame.maxY, min(list.frame.maxY, tabBar.frame.minY, capture.frame.minY),
            app.debugDescription)
        let label = row.staticTexts[title]
        requireHittable(label)
        let start = label.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
        let end = start.withOffset(CGVector(dx: -row.frame.width * 0.42, dy: 0))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    private func requireHittable(_ control: XCUIElement) {
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

    private func assertFeedbackClearsCapture(in app: XCUIApplication) {
        let capture = app.buttons["facet.capture.open"]
        requireHittable(capture)
        for identifier in ["facet.feedback.undo", "facet.feedback.dismiss"] {
            let action = app.buttons[identifier]
            if !action.exists {
                XCTAssertTrue(action.waitForExistence(timeout: 3), app.debugDescription)
            }
            requireHittable(action)
            XCTAssertFalse(action.frame.intersects(capture.frame), app.debugDescription)
        }
    }

    private func assertUpcomingChrome(in app: XCUIApplication) {
        let navigation = app.navigationBars["Upcoming"]
        XCTAssertTrue(navigation.waitForExistence(timeout: 10), app.debugDescription)
        requireHittable(navigation.staticTexts["Upcoming"])
        for identifier in [
            "facet.search.open", "facet.settings.open", "facet.sort.open",
            "facet.filters.open", "facet.selection.toggle",
        ] {
            requireHittable(app.buttons[identifier])
        }
    }

    private func requireViewer() throws {
        let environment = ProcessInfo.processInfo.environment
        let day = try XCTUnwrap(environment["FACET_PARITY_DAY"])
        let zone = try XCTUnwrap(environment["FACET_PARITY_TIME_ZONE"])
        XCTAssertEqual(
            TimeZone.current.identifier, zone, "The real simulator timezone must match its seed")
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        XCTAssertEqual(
            formatter.string(from: Date()), day, "The real viewer day changed during acceptance")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let environment = ProcessInfo.processInfo.environment
        guard let owned = environment["FACET_E2E_SIMULATOR"],
            owned == environment["SIMULATOR_UDID"], app.state == .runningForeground
        else {
            XCTFail("Paired captures require the foreground app on the harness-owned simulator.")
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
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
        let screen = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screen.name = name + " [owned simulator screen]"
        screen.lifetime = .keepAlways
        add(screen)
    }
}
