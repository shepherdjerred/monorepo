import Foundation
import TaskNotesKit
import XCTest

/// A separate synthetic vault; the four ordinary capture workflows remain unchanged.
@MainActor
final class OccurrenceVaultUITests: XCTestCase {
    func testGenerationRepairUndoAndColdRelaunch() async throws {
        continueAfterFailure = false
        let context = try OccurrenceVaultContext(test: self)
        let originalParent = try Data(contentsOf: context.parent)
        let originalChild = try Data(contentsOf: context.child)
        var window = try context.launch()
        try context.wait("three automatic rolling children") {
            try context.children(parentPath: "Tasks/Rolling.md").count == 3
        }
        let rolling = try context.children(parentPath: "Tasks/Rolling.md")
        try proveNoOpPreservesUndo(context, window: window, child: originalChild)
        XCTAssertEqual(try Data(contentsOf: context.parent), originalParent)
        try completeChild(context, window: window)
        let completed = try Data(contentsOf: context.child)
        let completedParent = try Data(contentsOf: context.parent)
        try context.retainPrimary(parent: completedParent, child: completed)
        try await capture(
            context, window: window, name: "01 Primary completion retains generation failure")
        try context.terminate()
        try context.restoreOwnedTemplate()
        window = try context.launch()
        try await proveRepairUndo(
            context, window: window, parent: completedParent, child: completed)
        try repair(context, window: window)
        let repairedParent = try Data(contentsOf: context.parent)
        let future = try XCTUnwrap(context.future())
        let futureBytes = try Data(contentsOf: future)
        try context.terminate()
        window = try context.launch()
        XCTAssertTrue(
            task("Occurrence repair parent \(context.nextDay)", window).waitForExistence(
                timeout: 15))
        XCTAssertEqual(try Data(contentsOf: context.parent), repairedParent)
        XCTAssertEqual(try Data(contentsOf: context.child), completed)
        XCTAssertEqual(try Data(contentsOf: future), futureBytes)
        XCTAssertEqual(try context.children(parentPath: "Tasks/Rolling.md"), rolling)
        try await capture(
            context, window: window, name: "04 Repaired occurrence survives cold relaunch")
        try context.terminate()
    }

    private func proveNoOpPreservesUndo(
        _ context: OccurrenceVaultContext, window: XCUIElement, child: Data
    ) throws {
        try completeChild(context, window: window)
        click(window.buttons["All tasks"])
        click(task("Occurrence rolling parent", window))
        let generate = window.buttons["facet.series.generate"]
        click(generate)
        let finished = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in generate.exists && generate.isEnabled }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 15), .completed)
        window.typeKey("z", modifierFlags: [.command, .option])
        try context.wait("completion Undo after no-op Generate") {
            try Data(contentsOf: context.child) == child
        }
        XCTAssertEqual(try context.note(context.child).properties["status"], .string("open"))
    }

    private func completeChild(_ context: OccurrenceVaultContext, window: XCUIElement) throws {
        click(window.buttons["All tasks"])
        click(window.buttons["Complete Occurrence repair child"])
        try context.wait("completed child") {
            try context.note(context.child).properties["status"] == .string("done")
        }
        click(window.buttons["Completed"])
        click(task("Occurrence repair child", window))
        XCTAssertTrue(
            window.staticTexts["Future occurrence needs attention"].waitForExistence(timeout: 10))
    }

    private func proveRepairUndo(
        _ context: OccurrenceVaultContext, window: XCUIElement, parent: Data, child: Data
    ) async throws {
        try repair(context, window: window)
        try await capture(
            context, window: window, name: "02 Explicit Repair creates one future occurrence")
        window.typeKey("z", modifierFlags: [.command, .option])
        try context.wait("exact repair Undo") {
            try Data(contentsOf: context.parent) == parent && context.future() == nil
        }
        XCTAssertEqual(try Data(contentsOf: context.child), child)
        try await capture(
            context, window: window,
            name: "03 Repair Undo restores exact parent and preserves completed child")
    }

    private func repair(_ context: OccurrenceVaultContext, window: XCUIElement) throws {
        click(window.buttons["All tasks"])
        click(task("Occurrence repair parent", window))
        let button = window.buttons["facet.series.repair"]
        XCTAssertTrue(button.waitForExistence(timeout: 15))
        XCTAssertEqual(window.buttons.matching(identifier: "facet.series.repair").count, 1)
        click(button)
        try context.wait("one repaired future child") { try context.future() != nil }
        let future = try XCTUnwrap(context.future())
        XCTAssertEqual(
            try context.note(future).properties["occurrence_date"], .string(context.nextDay))
        XCTAssertEqual(
            try context.note(context.parent).properties["complete_instances"],
            .array([.string(context.day)]))
    }

    private func task(_ title: String, _ window: XCUIElement) -> XCUIElement {
        window.staticTexts.matching(NSPredicate(format: "value == %@", title)).element
    }

    private func click(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: 15))
        XCTAssertTrue(element.isEnabled)
        element.click()
    }

    private func capture(_ context: OccurrenceVaultContext, window: XCUIElement, name: String)
        async throws
    {
        try await MacAcceptanceCapture.attach(
            app: context.app, name: name, test: self, windows: [window])
    }
}
