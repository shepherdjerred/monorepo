import Foundation
import XCTest

/// Selected separately from the normal three iOS and four Mac workflows.
@MainActor final class DependencyEditorUITests: XCTestCase {
    private let title = "Dependency acceptance task"

    func testDependencyOptionsAndEditsSurviveColdLaunch() async throws {
        continueAfterFailure = false
        let app = try application()
        addTeardownBlock { @MainActor in app.terminate() }
        app.launch()
        let form = try openEditor(app)
        replace(form.textFields["facet.dependencies.gap.0"], with: "P2D", in: form, app: app)
        let add = form.buttons["facet.dependencies.add"]
        reveal(add, in: form, app: app)
        press(add)
        replace(
            form.textFields["facet.dependencies.uid.2"], with: "Tasks/Second.md", in: form, app: app
        )
        replace(form.textFields["facet.dependencies.gap.2"], with: "PT30M", in: form, app: app)
        let relationship = form.descendants(matching: .any).matching(
            identifier: "facet.dependencies.relationship.2"
        ).firstMatch
        XCTAssertTrue(relationship.exists, app.debugDescription)
        try await attach(app, name: "01 Configured dependency default and explicit gap edits")
        let save = app.buttons["facet.editor.save"]
        requireReady(save)
        press(save)
        XCTAssertTrue(form.waitForNonExistence(timeout: 10), app.debugDescription)
        app.terminate()
        app.launch()
        let reopened = try openEditor(app)
        for (identifier, expected) in [
            ("facet.dependencies.gap.0", "P2D"),
            ("facet.dependencies.uid.2", "Tasks/Second.md"),
            ("facet.dependencies.gap.2", "PT30M"),
        ] {
            let field = reopened.textFields[identifier]
            reveal(field, in: reopened, app: app)
            XCTAssertEqual(field.value as? String, expected, app.debugDescription)
        }
        try await attach(app, name: "02 Dependency edits survive a cold launch")
        press(app.buttons["Cancel"])
        XCTAssertTrue(reopened.waitForNonExistence(timeout: 10))
        app.terminate()
        XCTAssertEqual(app.state, .notRunning)
    }

    private func application() throws -> XCUIApplication {
        let environment = ProcessInfo.processInfo.environment
        #if os(iOS)
            let owned = try XCTUnwrap(environment["FACET_E2E_SIMULATOR"])
            XCTAssertEqual(owned, environment["SIMULATOR_UDID"])
            let app = XCUIApplication()
            app.launchEnvironment["FACET_E2E_SIMULATOR"] = owned
            app.launchArguments = ["--facet-native-acceptance"]
        #else
            let descriptor = try XCTUnwrap(environment["FACET_E2E_DESCRIPTOR"])
            let runID = try XCTUnwrap(
                environment["FACET_E2E_RUN_ID"].flatMap(UUID.init(uuidString:)))
            let fields = try JSONDecoder().decode(
                Descriptor.self, from: Data(contentsOf: URL(fileURLWithPath: descriptor)))
            XCTAssertEqual(fields.schemaVersion, 1)
            XCTAssertEqual(fields.runID, runID)
            XCTAssertNil(fields.allowedRemoteVaultID)
            _ = try MacAcceptanceOwnership.validate(
                descriptor: descriptor, stateDirectory: fields.stateDirectory, runID: runID)
            let app = XCUIApplication(bundleIdentifier: "red.sjer.tasknotes.mac.acceptance")
            app.launchArguments = [
                "--facet-acceptance-descriptor", descriptor, "--facet-native-acceptance",
            ]
        #endif
        addUIInterruptionMonitor(withDescription: "Unexpected dependency acceptance interruption") {
            _ in
            XCTFail("The owned dependency editor was interrupted. No alert was accepted.")
            return false
        }
        return app
    }

    private func openEditor(_ app: XCUIApplication) throws -> XCUIElement {
        #if os(iOS)
            let task = app.buttons.containing(.staticText, identifier: title).firstMatch
            requireReady(task)
            press(task)
            let form = app.descendants(matching: .any).matching(identifier: "facet.editor.form")
                .firstMatch
            XCTAssertTrue(form.waitForExistence(timeout: 10), app.debugDescription)
            return form
        #else
            let window = try MacAcceptanceWorkspace.initial(app: app)
            let task = window.staticTexts.matching(NSPredicate(format: "value == %@", title))
                .firstMatch
            requireReady(task)
            press(task)
            let advanced = window.buttons["facet.inspector.relationships"]
            let inspectors = window.scrollViews.containing(
                .button, identifier: "facet.inspector.relationships")
            XCTAssertEqual(inspectors.count, 1, app.debugDescription)
            let inspector = inspectors.element
            reveal(advanced, in: inspector, app: app)
            XCTAssertTrue(inspector.frame.contains(advanced.frame), app.debugDescription)
            press(advanced)
            let sheets = window.sheets.containing(.button, identifier: "facet.editor.save")
            XCTAssertTrue(sheets.element.waitForExistence(timeout: 10), app.debugDescription)
            XCTAssertEqual(sheets.count, 1, app.debugDescription)
            let sheet = sheets.element
            XCTAssertEqual(sheet.elementType, .sheet)
            let scrollers = sheet.scrollViews.containing(
                .textField, identifier: "facet.dependencies.uid.0")
            XCTAssertTrue(scrollers.element.waitForExistence(timeout: 10), app.debugDescription)
            XCTAssertEqual(scrollers.count, 1, app.debugDescription)
            let form = scrollers.element
            XCTAssertEqual(form.elementType, .scrollView)
            XCTAssertTrue(sheet.frame.contains(form.frame), app.debugDescription)
            return form
        #endif
    }

    private func replace(
        _ field: XCUIElement, with text: String, in form: XCUIElement, app: XCUIApplication
    ) {
        reveal(field, in: form, app: app)
        #if os(iOS)
            guard let previous = field.value as? String else {
                XCTFail(
                    "The owned dependency text field has no string value.\n\(app.debugDescription)")
                return
            }
            FacetKeyboardBootstrap.focus(field, in: app)
            if !previous.isEmpty {
                field.typeText(
                    String(repeating: XCUIKeyboardKey.delete.rawValue, count: previous.count))
            }
            FacetKeyboardBootstrap.typeText(text, into: field, in: app)
        #else
            field.click()
            field.typeKey("a", modifierFlags: .command)
            field.typeText(text)
        #endif
        XCTAssertEqual(field.value as? String, text, app.debugDescription)
    }

    private func reveal(_ control: XCUIElement, in form: XCUIElement, app: XCUIApplication) {
        _ = control.waitForExistence(timeout: 3)
        for _ in 0..<8 {
            #if os(iOS)
                if control.exists && control.isEnabled && control.isHittable { break }
            #else
                if control.exists && control.isEnabled && control.isHittable
                    && form.frame.contains(control.frame)
                {
                    break
                }
            #endif
            #if os(iOS)
                let top = max(form.frame.minY, app.navigationBars.firstMatch.frame.maxY)
                let bottom =
                    app.keyboards.firstMatch.exists
                    ? min(form.frame.maxY, app.keyboards.firstMatch.frame.minY) : form.frame.maxY
                let movingDown = !control.exists || control.frame.midY >= top
                let origin = app.coordinate(withNormalizedOffset: .zero)
                let start = origin.withOffset(
                    CGVector(
                        dx: form.frame.midX, dy: top + (bottom - top) * (movingDown ? 0.75 : 0.3)))
                let end = origin.withOffset(
                    CGVector(
                        dx: form.frame.midX, dy: top + (bottom - top) * (movingDown ? 0.3 : 0.75)))
                start.press(forDuration: 0.05, thenDragTo: end)
            #else
                form.scroll(
                    byDeltaX: 0,
                    deltaY: control.exists && control.frame.midY < form.frame.minY ? 220 : -220)
            #endif
        }
        requireReady(control)
        #if os(macOS)
            XCTAssertTrue(form.frame.contains(control.frame), app.debugDescription)
        #endif
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

    private func press(_ control: XCUIElement) {
        #if os(iOS)
            control.tap()
        #else
            control.click()
        #endif
    }

    private func attach(_ app: XCUIApplication, name: String) async throws {
        XCTAssertEqual(app.alerts.count, 0)
        XCTAssertEqual(app.secureTextFields.count, 0)
        for identifier in [
            "facet.account.email", "facet.account.password", "facet.account.code",
            "facet.account.vault-password",
        ] {
            XCTAssertFalse(
                app.descendants(matching: .any).matching(identifier: identifier).firstMatch.exists)
        }
        #if os(iOS)
            XCTAssertEqual(
                ProcessInfo.processInfo.environment["FACET_E2E_SIMULATOR"],
                ProcessInfo.processInfo.environment["SIMULATOR_UDID"])
            XCTAssertEqual(app.state, .runningForeground)
            for screenshot in [app.screenshot(), XCUIScreen.main.screenshot()] {
                let image = XCTAttachment(screenshot: screenshot)
                image.name = name
                image.lifetime = .keepAlways
                add(image)
            }
        #else
            let window = try MacAcceptanceWorkspace.initial(app: app)
            try await MacAcceptanceCapture.attach(
                app: app, name: name, test: self, windows: [window])
        #endif
    }

    private struct Descriptor: Decodable {
        let schemaVersion: Int
        let runID: UUID
        let stateDirectory: String
        let allowedRemoteVaultID: String?
    }
}
