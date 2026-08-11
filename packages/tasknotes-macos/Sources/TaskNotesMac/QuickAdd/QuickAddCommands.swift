public import SwiftUI

/// The File-menu item that opens the quick-add panel.
///
/// ## Why a menu item exists at all for a global hotkey
///
/// Because the hotkey can be cleared. The Settings recorder's clear button is a
/// supported answer — not everybody wants another application holding a
/// system-wide key — and without a menu item that choice would silently delete
/// the feature. It is also the only place the panel is *discoverable*: nothing
/// else in the app hints that it exists.
///
/// It sits next to New Task in File, because it is the other way to make one.
///
/// ⚠️ **No key equivalent, deliberately.** The obvious move is to put the global
/// binding on this item, and it would be wrong twice over: a SwiftUI
/// `.keyboardShortcut` is a *local* shortcut that only fires while TaskNotes is
/// frontmost, so it would claim the same keys for a strictly weaker behaviour,
/// and it would then be a second registration of a binding the user can change
/// in Settings, which the menu would not track. The binding is shown where it
/// can be edited instead.
public struct QuickAddCommands: Commands {
    private let environment: AppEnvironment

    public init(environment: AppEnvironment) {
        self.environment = environment
    }

    public var body: some Commands {
        CommandGroup(after: .newItem) {
            Button("Quick Add…", systemImage: "plus.viewfinder") {
                environment.quickAdd.present()
            }
        }
    }
}
