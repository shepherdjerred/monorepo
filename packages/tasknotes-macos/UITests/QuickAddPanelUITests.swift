import AppKit
import TaskNotesKit
import XCTest

/// The two things about the quick-add panel that only a real run can settle.
///
/// Phase 9c built the panel and could prove exactly one thing about it: that the
/// binding is written into the app's defaults. Everything that makes the feature
/// worth having — that the key actually fires, and that the panel arrives
/// *without* dragging TaskNotes to the front — is invisible to an offscreen
/// renderer and to a unit test, because both of them are the frontmost app by
/// construction.
///
/// ## Why `CGEvent` rather than `typeKey`
///
/// `XCUIElement.typeKey(_:modifierFlags:)` delivers to a *specific application*.
/// That is precisely the wrong instrument here: a global hotkey is defined by
/// being seen when the app is **not** the one receiving keystrokes, so a
/// per-application send would pass whether or not the feature worked. Posting to
/// the HID event tap is the only way to ask the real question.
final class QuickAddPanelUITests: XCTestCase {
    /// The virtual keycode for Space. `kVK_Space` from `Carbon.HIToolbox`,
    /// spelled literally so this file does not import Carbon for one constant.
    /// It matches the `carbonKeyCode: 49` Phase 9c observed in the app's stored
    /// binding, which is the only reason that observation was meaningful.
    private static let spaceKeyCode: CGKeyCode = 49

    override func setUp() {
        continueAfterFailure = false
    }

    /// Launch the app pointed at nothing, and tear it down with the test.
    ///
    /// Goes through ``TestApp`` rather than `XCUIApplication().launch()` so the
    /// app cannot inherit the developer's real server address or Keychain
    /// token — see the note there; this suite once pulled a live vault.
    private func launchedApp() -> XCUIApplication {
        TestApp.launch { addTeardownBlock($0) }
    }

    /// ⇧⌘Space opens the panel.
    ///
    /// The plain case, asserted first so that a failure in the harder one below
    /// can be attributed: if this passes and that fails, the hotkey works and
    /// the activation behaviour does not.
    func testTheGlobalHotkeyOpensTheQuickAddPanel() throws {
        let app = launchedApp()
        let panel = app.windows[AccessibilityIdentifier.QuickAdd.panel]
        XCTAssertFalse(panel.exists, "the panel was already open before the hotkey")

        try postGlobalShiftCommandSpace()

        XCTAssertTrue(
            panel.waitForExistence(timeout: 5),
            "⇧⌘Space did not open the quick-add panel: \(app.debugDescription)"
        )
        XCTAssertTrue(
            app.textFields[AccessibilityIdentifier.QuickAdd.field].exists,
            "the panel opened without its text field"
        )

        try app.performAccessibilityAudit()
    }

    /// The panel arrives over another application without activating TaskNotes.
    ///
    /// This is the assertion the whole non-activating-panel design exists for —
    /// `.nonactivatingPanel`, `canBecomeKey` true while `canBecomeMain` stays
    /// false, `isFloatingPanel`, `.canJoinAllSpaces`. Every one of those is
    /// deletable without changing how the panel *looks*, which is why Phase 9c
    /// asserted them structurally and flagged that only a real run could show
    /// they add up to the behaviour.
    ///
    /// Finder is the other application: it is always running, it cannot fail to
    /// launch, and activating it costs nothing.
    func testThePanelOpensOverAnotherAppWithoutActivatingTaskNotes() throws {
        let app = launchedApp()
        let finder = XCUIApplication(bundleIdentifier: "com.apple.finder")
        finder.activate()
        XCTAssertTrue(
            waitForFrontmostBundleIdentifier("com.apple.finder", timeout: 10),
            "Finder never became frontmost; the premise of this test did not hold"
        )

        try postGlobalShiftCommandSpace()

        let panel = app.windows[AccessibilityIdentifier.QuickAdd.panel]
        XCTAssertTrue(
            panel.waitForExistence(timeout: 5),
            "⇧⌘Space did not open the panel while another app was frontmost"
        )

        // The load-bearing half. A panel that opened *and* pulled TaskNotes to
        // the front would satisfy the assertion above and still be the wrong
        // feature: the point is to capture a thought without losing your place.
        let frontmost = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        XCTAssertEqual(
            frontmost,
            "com.apple.finder",
            "opening the panel stole activation from the frontmost application"
        )
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// Post ⇧⌘Space to the system, not to any particular application.
    ///
    /// Throws rather than force-unwrapping so a refusal by the event system is
    /// reported as a failing test with a reason, instead of a crash in the
    /// runner that looks like a harness bug.
    private func postGlobalShiftCommandSpace() throws {
        let source = try XCTUnwrap(
            CGEventSource(stateID: .hidSystemState),
            "could not create a HID event source"
        )
        let flags: CGEventFlags = [.maskShift, .maskCommand]

        let down = try XCTUnwrap(
            CGEvent(
                keyboardEventSource: source,
                virtualKey: Self.spaceKeyCode,
                keyDown: true
            ),
            "could not create the key-down event"
        )
        down.flags = flags
        down.post(tap: .cghidEventTap)

        let up = try XCTUnwrap(
            CGEvent(
                keyboardEventSource: source,
                virtualKey: Self.spaceKeyCode,
                keyDown: false
            ),
            "could not create the key-up event"
        )
        up.flags = flags
        up.post(tap: .cghidEventTap)
    }

    /// Poll until the frontmost application matches, or give up.
    ///
    /// Activation is asynchronous and there is no notification the test process
    /// can await without a run loop, so this is a bounded poll rather than a
    /// sleep — a fixed sleep would be both slower and flakier.
    private func waitForFrontmostBundleIdentifier(
        _ identifier: String,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if NSWorkspace.shared.frontmostApplication?.bundleIdentifier == identifier {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return false
    }
}
