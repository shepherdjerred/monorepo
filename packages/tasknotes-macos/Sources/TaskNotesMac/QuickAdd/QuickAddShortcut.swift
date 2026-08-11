internal import AppKit
internal import KeyboardShortcuts

/// The global hotkey that opens the quick-add panel.
///
/// ## Why this library and not a `CGEventTap`
///
/// There are exactly two ways for an app to see a keystroke that was never sent
/// to it. `RegisterEventHotKey` — Carbon, still supported, what this wraps —
/// asks the window server to deliver one specific combination and needs **no
/// permission at all**. A `CGEventTap` sees every keystroke on the machine and
/// therefore needs the Accessibility permission, which is a System Settings
/// trip, a restart, and a dialog saying this app wants to control your
/// computer. Asking for that in order to offer a text field is not a trade
/// worth making, and it is why the plan names this dependency.
///
/// ## Why there is an initial binding at all
///
/// `KeyboardShortcuts.Name` can carry its own default, and its documentation
/// says not to use one, because "users find it annoying when random apps steal
/// their existing keyboard shortcuts". That is right in general and wrong here
/// for one specific reason: this app has no onboarding, so an unbound hotkey
/// would leave the panel with **no way to open it** until somebody found a
/// Settings pane they had no reason to look for.
///
/// ⚠️ **The first choice here was `⇧⌘Space`, and it was wrong.** The reasoning
/// was that `⌘Space`, `⌃Space`, `⌥⌘Space` and `⌃⌘Space` are spoken for —
/// Spotlight, input sources, the Finder search window, the character picker —
/// while `⇧⌘Space` is free. It is not: 1Password binds it by default, and
/// macOS 26 added a system Siri handler for it. Both sit ahead of a Carbon
/// `RegisterEventHotKey` in the dispatch order, so the panel simply never
/// opened. Found by pressing the key on a real machine; nothing in the suite
/// could have told us, because a hotkey's competition is whatever the user
/// happens to have installed.
///
/// `⌃⌥⌘Space` keeps the Space muscle memory and clears all six known
/// claimants by adding a third modifier. It is a *better guess*, not a
/// guarantee — no combination can be — which is the real argument for the
/// recorder in Settings being the answer rather than the default.
///
/// Clearing the binding sticks, which is the part worth checking in a library
/// that offers a default: `Name`'s own mechanism writes a disabled sentinel
/// rather than treating "nothing bound" as "apply the default again", so an
/// unbound hotkey stays unbound across launches. Not everybody wants another
/// application holding a system-wide key, and that answer has to survive a
/// relaunch.
///
/// _Phase 9c originally seeded this by hand behind a `UserDefaults` flag,
/// because the argument label below is spelled `default:` and this package's
/// `banned_switch_default` rule matched it. That was a rule defect — the regex
/// could not tell a `switch` case from an argument label — and the rule now
/// discriminates on SourceKit's syntax kind instead, so the library's own
/// mechanism is usable and the hand-rolled flag is gone._
extension KeyboardShortcuts.Name {
    static let quickAdd = Self(
        "quickAdd",
        default: .init(.space, modifiers: [.control, .option, .command])
    )
}
