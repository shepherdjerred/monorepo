internal import AppKit
internal import TaskNotesKit

/// The floating window the quick-add field lives in.
///
/// ## Non-activating is the whole feature
///
/// The point of a global quick-add is that you capture a task **without leaving
/// what you were doing**. A window that activates TaskNotes to show a text
/// field has already failed at that: the app you were in loses key focus, its
/// menu bar is replaced, and on the way back your text selection and often your
/// scroll position are gone. Four properties together are what avoid it, and
/// each one is load-bearing:
///
///   1. **`.nonactivatingPanel`.** An `NSPanel` with this style mask can become
///      the *key* window — and therefore receive keystrokes — while its
///      application stays inactive. It is the only style mask that can. Without
///      it, `makeKey()` on a background app's window either does nothing or
///      drags the whole app forward.
///   2. **``canBecomeKey`` overridden to `true`.** A panel without a title bar
///      refuses key status by default, which would leave a text field nobody
///      can type into. ``canBecomeMain`` stays `false`: main is the *app's*
///      document window, and claiming it is what would move activation.
///   3. **`isFloatingPanel` + `.floating` level.** Keeps the panel above the
///      application it was summoned over rather than behind it.
///   4. **`.canJoinAllSpaces`.** The hotkey is global, so the panel has to
///      appear on whichever Space the user is on — including over a full-screen
///      app, which is what `.fullScreenAuxiliary` adds.
///
/// `hidesOnDeactivate` completes it: clicking away is a dismissal, not a window
/// left floating over somebody's editor.
///
/// ## The chrome is AppKit's, not ours
///
/// The definition of done forbids custom window chrome, and this is a
/// deliberately standard `.utilityWindow` panel — a smaller title bar, a real
/// close button, `isMovableByWindowBackground` so it can be dragged like every
/// other panel. The title is hidden and the bar is transparent, which are
/// first-class `NSWindow` properties rather than drawing, so the traffic light
/// stays where the system puts it and nothing here paints a frame.
final class QuickAddPanel: NSPanel {
    /// A panel that can take the keyboard.
    ///
    /// Required, and the failure without it is quiet: the panel appears, the
    /// caret never blinks, and every keystroke goes to the app underneath.
    override var canBecomeKey: Bool { true }

    /// A panel that is never the application's main window.
    ///
    /// `false` is AppKit's default for a panel and is restated because it is the
    /// half of "non-activating" that people delete by accident. Becoming main is
    /// what pulls the application forward.
    override var canBecomeMain: Bool { false }

    /// Escape closes the panel from anywhere inside it.
    ///
    /// The text field already handles Escape itself — `cancelOperation(_:)` is
    /// what the field editor sends, and `PlainTextField` intercepts it — so this
    /// covers the case where focus is somewhere else in the panel, which is
    /// otherwise a floating window with no visible way out.
    ///
    /// `orderOut` rather than `performClose`, deliberately: the panel is reused
    /// on every summoning, and closing it would take the `NSHostingView` with
    /// it.
    override func cancelOperation(_ sender: Any?) {
        orderOut(nil)
    }

    /// A panel configured the way the documentation above describes.
    ///
    /// - Parameter content: the view the panel hosts, already built.
    init(content: NSView) {
        super.init(
            contentRect: CGRect(origin: .zero, size: Self.contentSize),
            styleMask: [
                .titled, .closable, .utilityWindow, .nonactivatingPanel, .fullSizeContentView,
            ],
            backing: .buffered,
            defer: false
        )

        // ⚠️ On the **window**, not only on the hosted SwiftUI view.
        //
        // `QuickAddPanelView` already carries
        // `.accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.panel)`,
        // and that was assumed to be enough. It is not: a SwiftUI identifier
        // names an element *inside* the window's content, while
        // `XCUIApplication.windows[_:]` matches the **window element itself**.
        // The panel therefore came back from the accessibility tree as
        // `subrole=AXSystemFloatingWindow` with no title and no identifier, so
        // `app.windows[AccessibilityIdentifier.QuickAdd.panel]` matched nothing
        // and the two hotkey flows failed as "the hotkey did not open the
        // panel" — describing a working feature as a broken one. Measured with
        // `AXUIElementCopyAttributeValue` against the running app while a
        // screenshot showed the panel plainly on screen.
        //
        // The title is set for the same reason and is *not* redundant with
        // `titleVisibility = .hidden` below: hiding the title stops it being
        // drawn, it does not stop VoiceOver reading it. An untitled floating
        // window is announced as nothing at all.
        setAccessibilityIdentifier(AccessibilityIdentifier.QuickAdd.panel)
        title = "Quick Add"

        isFloatingPanel = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        hidesOnDeactivate = true

        // Never released on close, because the controller keeps showing the
        // same panel: a released window would be a use-after-free the second
        // time the hotkey is pressed.
        isReleasedWhenClosed = false

        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        isMovableByWindowBackground = true
        // ⚠️ Hidden because `.fullSizeContentView` puts the content *under* the
        // title bar, so a close button would sit on top of the panel's own
        // leading glyph — measured on the running app, where the panel's frame
        // comes back 560 × 121 for a 118-point content view, which is the
        // titlebar taking no height of its own.
        //
        // This is not "custom chrome": nothing here draws a frame or a
        // substitute button. It is the standard shape for a window summoned by
        // a key rather than opened — Spotlight, the Character Viewer and Xcode's
        // Open Quickly all have none — and there are three ways out already,
        // one of which the panel prints: Escape, ⌘W, and clicking away.
        standardWindowButton(.closeButton)?.isHidden = true
        // `.utilityWindow` is AppKit's own fade for a panel like this. The
        // default would be a document window's zoom, which is the wrong verb for
        // something that appears over another application.
        animationBehavior = .utilityWindow
        // It is summoned by a key, not chosen from a list, and it holds no
        // document state worth returning to.
        isExcludedFromWindowsMenu = true

        contentView = content
    }

    /// The panel's size, in points.
    ///
    /// Wide enough that a sentence with a project, a context and a date still
    /// reads as one line, and short enough that it never feels like a window.
    static let contentSize = CGSize(width: 560, height: 118)

    /// Where the panel should sit on `screen`.
    ///
    /// Horizontally centred, and a third of the way down rather than in the
    /// middle: a centred panel lands on whatever the user was reading, and the
    /// upper third is where every summoned field on this platform appears —
    /// Spotlight, the Character Viewer, and Xcode's Open Quickly all sit there.
    static func origin(on screen: NSScreen) -> CGPoint {
        let visible = screen.visibleFrame
        return CGPoint(
            x: visible.midX - contentSize.width / 2,
            y: visible.maxY - visible.height / 3 - contentSize.height / 2
        )
    }

    /// The screen the panel should appear on.
    ///
    /// The one holding the pointer, which is the best available guess at where
    /// the user is looking — better than `NSScreen.main`, which on a background
    /// app is the screen with the *key window*, and this app very likely has
    /// none. `nil` only when there are no screens at all, which is a headless
    /// session rather than a case to paper over.
    static func preferredScreen(pointerAt location: CGPoint) -> NSScreen? {
        NSScreen.screens.first { $0.frame.contains(location) } ?? NSScreen.screens.first
    }
}
