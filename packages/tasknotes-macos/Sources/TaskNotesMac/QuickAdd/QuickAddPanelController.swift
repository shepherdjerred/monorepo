internal import AppKit
internal import KeyboardShortcuts
internal import Observation
internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

internal import class Foundation.UserDefaults

/// The quick-add panel's state, and the one object that owns the global hotkey.
///
/// ## Why this is not a scene
///
/// Every other surface in this app is a SwiftUI scene, and this one deliberately
/// is not. A scene's window is created by SwiftUI when something opens it, is
/// an activating window, and cannot be made non-activating from the SwiftUI
/// side at all — `Window`, `WindowGroup` and `.windowStyle` expose no way to
/// reach `NSWindow.styleMask`. The whole value of a global quick-add is that it
/// does *not* pull the application forward, so the window is an `NSPanel` built
/// by hand and the SwiftUI part is only its content view.
///
/// ## Why it is owned by ``AppEnvironment``
///
/// Because the requirement is that the hotkey works **with no windows open**.
/// `AppEnvironment` is created as the `@State` initial value of the `App`
/// struct, which is constructed at launch before any scene exists, so
/// registering here means the hotkey is live from launch and stays live after
/// the last window is closed. Registering it from a view's `.task` would have
/// tied a global capability to the lifetime of a window that the user is
/// explicitly allowed to close.
@MainActor
@Observable
final class QuickAddPanelController {
    /// What the user has typed. Cleared on every presentation.
    var text = ""

    /// Where and when the viewer is, read once per presentation.
    ///
    /// One value for the whole session at the panel, matching every other
    /// screen: the preview's date and the created task's date are then derived
    /// against the same instant, which around midnight is the difference
    /// between "Tomorrow" and a task dated yesterday.
    ///
    /// `nil` when the store could not be built, which is the one state where the
    /// panel has a field it must not offer.
    private(set) var calendar: ViewerCalendar?

    /// Bumped on every presentation, so the field can take focus again.
    ///
    /// The panel and its hosting view are built once and reused, so `onAppear`
    /// fires exactly once in the app's life — which would leave the second
    /// summoning with no caret. A token the view watches is what re-arms it.
    private(set) var focusToken = 0

    /// The task store, or the failure that prevented building one.
    private let store: Result<TaskNotesStore, CoreError>

    @ObservationIgnored private var panel: QuickAddPanel?
    @ObservationIgnored private var isHotkeyInstalled = false

    init(store: Result<TaskNotesStore, CoreError>) {
        self.store = store
    }

    /// Claim the global hotkey.
    ///
    /// Idempotent, because `KeyboardShortcuts.onKeyDown` **appends** a handler
    /// rather than replacing one — calling it twice would open and immediately
    /// close the panel on a single press.
    func installHotkey() {
        guard !isHotkeyInstalled else { return }
        isHotkeyInstalled = true
        KeyboardShortcuts.onKeyDown(for: .quickAdd) { [weak self] in
            // The Carbon event handler runs on the main run loop, so this is
            // already the main actor — but the library predates Swift
            // concurrency and hands back a plain `() -> Void`, so the isolation
            // has to be asserted. `assumeIsolated` traps if the assumption is
            // ever wrong, which is the loud failure the principles ask for
            // rather than a hop that would make the panel appear a frame late.
            MainActor.assumeIsolated { self?.toggle() }
        }
    }

    /// Whether the panel is on screen.
    ///
    /// Derived from the window rather than mirrored in a stored flag, because
    /// AppKit hides the panel behind this object's back: `hidesOnDeactivate`
    /// orders it out when the user clicks another application, and a mirrored
    /// flag would then be stale in exactly the state where the next hotkey press
    /// has to open it.
    var isPresented: Bool { panel?.isVisible == true }

    /// Show the panel, or hide it if it is already up.
    ///
    /// A toggle rather than a show, because the hotkey is the only way in and
    /// pressing it twice has to be a way back out — the panel can be summoned
    /// over a full-screen app where nothing else is clickable.
    func toggle() {
        if isPresented {
            dismiss()
        } else {
            present()
        }
    }

    /// Everything a presentation sets up, short of putting a window on screen.
    ///
    /// Split out so the panel's *content* can be rendered without a panel — an
    /// offscreen snapshot has no business ordering a floating window in, and a
    /// controller whose only entry point also summoned a window would have made
    /// the content untestable.
    func prepare() {
        if case .success(let store) = store {
            calendar = store.viewerCalendar()
        }
        text = ""
        focusToken &+= 1
    }

    /// Put the panel up, focused, over whatever the user is looking at.
    func present() {
        prepare()

        let window = ensurePanel()
        if let screen = QuickAddPanel.preferredScreen(pointerAt: NSEvent.mouseLocation) {
            window.setFrameOrigin(QuickAddPanel.origin(on: screen))
        }
        // `orderFrontRegardless` rather than `makeKeyAndOrderFront`: the latter
        // is ignored for an inactive application, which is precisely the case
        // this panel exists for. `makeKey` afterwards is what gives it the
        // keyboard, and it works without activating because the panel carries
        // `.nonactivatingPanel`.
        window.orderFrontRegardless()
        window.makeKey()
    }

    /// Take the panel down without creating one that was never needed.
    func dismiss() {
        panel?.orderOut(nil)
    }

    /// What the core understood from what has been typed.
    ///
    /// `nil` when there is no store to derive against, which the view renders as
    /// its unavailable state rather than as an empty preview.
    var preview: Result<QuickAddPreview, CoreError>? {
        guard let calendar else { return nil }
        return QuickAddPreview.of(text, calendar: calendar)
    }

    /// Create the task and close.
    ///
    /// Declines silently for an empty line and for one the core could not parse.
    /// Neither is a case for an alert: the preview strip is already saying which
    /// of the two it is, one keystroke away from the caret, and a modal over a
    /// panel that is itself floating over another application would be two
    /// layers of interruption for a typo.
    func submit() {
        guard case .success(let store) = store, let calendar else { return }
        switch QuickAdd.parsing(text, calendar: calendar) {
        case .success(let command):
            guard let command else { return }
            store.dispatch(command)
            text = ""
            dismiss()
            // Detached, so the panel closes on the keystroke rather than after
            // a drain. `autoSync` armed the pass; this is what runs it.
            _Concurrency.Task { await store.settle() }
        case .failure:
            // Already visible in the preview strip, which is derived from the
            // same call. Reporting it into the store as well would raise a
            // banner on a list screen the user is not looking at, about a line
            // they are still typing.
            return
        }
    }

    private func ensurePanel() -> QuickAddPanel {
        if let panel { return panel }
        let hosting = NSHostingView(rootView: QuickAddPanelView(controller: self))
        hosting.frame = CGRect(origin: .zero, size: QuickAddPanel.contentSize)
        // ⚠️ The hosting view is a real element in the accessibility tree and it
        // sits *above* anything SwiftUI can annotate — `QuickAddPanelView`
        // already carries `.accessibilityLabel("Quick Add")` and it does not
        // reach here. `performAccessibilityAudit` reported it as a bare `Group`
        // at the panel's exact frame with no description, which is the one
        // finding in this window that neither the view nor the window could fix.
        hosting.setAccessibilityLabel("Quick Add")
        let created = QuickAddPanel(content: hosting)
        panel = created
        return created
    }
}
