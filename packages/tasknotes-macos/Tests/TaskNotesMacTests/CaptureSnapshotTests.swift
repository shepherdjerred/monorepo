import AppKit
import Foundation
import SwiftUI
import TaskNotesKit
import TaskNotesUniFFI
import Testing

@testable import TaskNotesMac

/// ## ⚠️ What these images cannot prove, and it is the important half
///
/// An offscreen renderer draws a view into a bitmap this process owns. It never
/// orders a window in, never activates an application, and never sees a
/// keystroke. So **nothing here can show that the global hotkey fires, that the
/// panel appears over another application, or that it does so without pulling
/// TaskNotes forward** — the three properties that are the entire point of the
/// panel. What is covered instead is split in two:
///
///   * these images, for everything the panel *says*, and
///   * ``QuickAddPanelConfigurationTests``, for the window properties that make
///     it non-activating — which are ordinary `NSWindow` state and can be
///     asserted without ever showing the window.
///
/// The remaining gap — that macOS honours those properties, and that
/// `RegisterEventHotKey` delivers — is a real run or an XCUITest, and is
/// reported as such rather than papered over with a green test.
@Suite("The capture surface, rendered offscreen", .serialized)
@MainActor
struct CaptureSnapshotTests {
    // ── The quick-add panel ────────────────────────────────────────────────

    /// The panel in each state its footer has.
    ///
    /// Four states rather than one, because the footer is the whole feature: it
    /// is the only account the user ever gets of what Return will create, and
    /// each branch says something different. The syntax hint is the one worth
    /// staring at — it is where somebody learns that `!high` and `p:` mean
    /// anything at all.
    @Test(
        "the quick-add panel",
        arguments: QuickAddVariant.allCases, SnapshotAppearance.allCases
    )
    func quickAddPanel(variant: QuickAddVariant, appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        let controller = QuickAddPanelController(store: .success(seeded.store))
        controller.prepare()
        controller.text = variant.text

        try record(
            QuickAddPanelView(controller: controller)
                // The panel's own size, so the image is the window rather than
                // a view stretched to whatever a test picked.
                .frame(
                    width: QuickAddPanel.contentSize.width,
                    height: QuickAddPanel.contentSize.height
                ),
            named: "quickadd-\(variant.rawValue)",
            size: QuickAddPanel.contentSize,
            appearance: appearance
        )
    }
}

/// What is in the quick-add field when the picture is taken.
enum QuickAddVariant: String, CaseIterable, Sendable {
    /// Empty — the state the panel is always summoned into, and the only one
    /// that teaches the syntax.
    case empty
    /// A plain title, which the core recognised nothing in.
    case plain
    /// The line from the brief, with every token kind on it.
    case parsed
    /// Only tokens, so there is no task to create.
    case tokensOnly

    var text: String {
        switch self {
        case .empty: ""
        case .plain: "Take the car in for its service"
        case .parsed: "Fix the boiler !high p:Home @errands #urgent tomorrow"
        case .tokensOnly: "!high @errands"
        }
    }
}

/// The panel's window properties, which no image can show.
///
/// Every one of these is what makes the panel appear over another application
/// without stealing its focus, and every one of them is a single property that
/// somebody could delete while the panel kept looking identical in a snapshot.
/// The window is constructed and never ordered in, so this steals nothing from
/// whoever is using the Mac — the same discipline ``OffscreenSnapshot`` follows.
@Suite("The quick-add panel's window")
@MainActor
struct QuickAddPanelConfigurationTests {
    private func panel() -> QuickAddPanel {
        QuickAddPanel(
            content: NSView(frame: CGRect(origin: .zero, size: QuickAddPanel.contentSize)))
    }

    /// The one property without which the whole feature is a normal window.
    @Test("the panel is non-activating")
    func nonActivating() {
        #expect(panel().styleMask.contains(.nonactivatingPanel))
    }

    /// A panel that cannot become key is a text field nobody can type into.
    @Test("the panel takes the keyboard but never becomes main")
    func keyWithoutMain() {
        let panel = panel()
        #expect(panel.canBecomeKey)
        #expect(!panel.canBecomeMain)
    }

    @Test("the panel floats above the application it was summoned over")
    func floats() {
        let panel = panel()
        #expect(panel.isFloatingPanel)
        #expect(panel.level == .floating)
    }

    /// A global hotkey reaches every Space, so the panel has to as well.
    @Test("the panel follows the user onto any Space, including a full-screen one")
    func everySpace() {
        let behavior = panel().collectionBehavior
        #expect(behavior.contains(.canJoinAllSpaces))
        #expect(behavior.contains(.fullScreenAuxiliary))
    }

    /// ⚠️ This test used to assert the opposite, and was wrong.
    ///
    /// "Clicking away is a dismissal" is the right behaviour; `hidesOnDeactivate`
    /// is the wrong mechanism for it here. That flag hides a window whenever its
    /// **application** is not active, and this panel's whole purpose is to be
    /// summoned while the application is not active — so AppKit ordered it back
    /// out and the panel only ever opened when TaskNotes already happened to be
    /// frontmost.
    ///
    /// The test passing on `true` is what let that ship: it asserted a property
    /// rather than the behaviour the property was chosen for. Dismissal now
    /// hangs off `resignKey()`, which fires on a click elsewhere and not merely
    /// because another application owns the menu bar.
    @Test("the panel does not hide merely because another application is frontmost")
    func doesNotHideOnDeactivate() {
        #expect(panel().hidesOnDeactivate == false)
    }

    /// It is summoned by a key and holds no state worth returning to.
    @Test("the panel is not offered in the Window menu")
    func notInWindowMenu() {
        #expect(panel().isExcludedFromWindowsMenu)
    }

    /// Reused on every summoning, so a close must not take the hosting view.
    @Test("the panel survives being closed")
    func survivesClose() {
        #expect(!panel().isReleasedWhenClosed)
    }

    /// It is never shown by construction; asserted so a future edit that ordered
    /// it in from `init` fails here rather than in front of the user.
    @Test("constructing the panel does not show it")
    func staysHidden() {
        #expect(!panel().isVisible)
    }
}
