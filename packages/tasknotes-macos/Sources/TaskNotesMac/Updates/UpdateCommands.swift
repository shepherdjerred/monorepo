public import SwiftUI

/// The App-menu item that checks for a new version.
///
/// ## Placement
///
/// `CommandGroup(after: .appInfo)` puts it directly below *About TaskNotes* and
/// above the Settings item the `Settings` scene contributes — which is where
/// every Sparkle app on the platform puts it, and where a Mac user looks for
/// it. Nothing here declares a keyboard shortcut: checking for updates is not a
/// frequent verb, and the accelerators near it are all taken.
///
/// ## Disabled, never hidden
///
/// The item is unconditionally present. It greys out in exactly two states —
/// while a check is already running, and in a build with no update channel
/// configured — and in both the plan's definition of done says the user should
/// still be able to see that the command exists.
///
/// A separate `Commands` conformer rather than another case inside
/// ``TaskNotesCommands``, on the same rule quick-add follows: a menu item
/// belongs beside the thing it drives, and this one is the only part of the UI
/// that knows Sparkle exists.
public struct UpdateCommands: Commands {
    private let updater: UpdaterController

    public init(updater: UpdaterController) {
        self.updater = updater
    }

    public var body: some Commands {
        CommandGroup(after: .appInfo) {
            // The ellipsis is required by the platform's own convention: the
            // item opens a window that asks for a decision rather than acting
            // immediately.
            Button("Check for Updates…") { updater.checkForUpdates() }
                .disabled(!updater.canCheckForUpdates)
        }
    }
}
