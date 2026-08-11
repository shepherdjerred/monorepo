internal import KeyboardShortcuts
internal import SwiftUI
internal import TaskNotesKit

/// The Settings pane that rebinds the quick-add hotkey.
///
/// A global hotkey is the one binding in an application that can genuinely
/// conflict with something the user already has, because it is claimed from the
/// window server rather than from a menu — so it has to be changeable, and it
/// has to be changeable somewhere findable. `KeyboardShortcuts.Recorder` is the
/// library's own control: it records a real key combination, refuses ones the
/// system has taken, writes straight to `UserDefaults`, and re-registers the
/// hotkey without anything here doing so.
///
/// **Clearing it is a supported answer.** The recorder's own clear button
/// leaves the name unbound, and an unbound name registers nothing at all — which
/// is the right outcome for somebody who does not want another application
/// holding a system-wide key.
struct QuickAddSettingsView: View {
    var body: some View {
        Form {
            KeyboardShortcuts.Recorder("Quick Add", name: .quickAdd)
                .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.shortcutRecorder)
            // Stated rather than assumed: a panel that appears over another
            // application is unusual enough that saying what it will do is
            // worth two lines, and it is also where the user learns that the
            // app does not have to be frontmost.
            Text(
                "Opens a floating field over whatever you are working in, "
                    + "without switching to Facet. Return adds the task, Escape closes."
            )
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .formStyle(.grouped)
    }
}
