public import SwiftUI
internal import TaskNotesKit

/// The main window: a three-pane-capable `NavigationSplitView` currently used
/// with two columns.
///
/// This is the RN app's bottom tab bar translated to the platform idiom, not
/// ported. The sidebar is a real source list, so it gets Cmd-clickable rows,
/// system selection colours that de-emphasize on focus loss, and
/// `⌘⌃S` sidebar toggling for free — none of which a re-implemented tab bar
/// would have.
public struct RootView: View {
    @Bindable private var navigation: NavigationState

    public init(navigation: NavigationState) {
        self.navigation = navigation
    }

    public var body: some View {
        NavigationSplitView {
            // `selection:` is non-optional, matching `NavigationState`: there
            // is no "nothing selected" state in this app.
            List(SidebarSection.allCases, id: \.self, selection: $navigation.selection) { section in
                Label(section.title, systemImage: section.systemImage)
                    // A `Label` is a container; putting the identifier on it
                    // without combining pushes the identifier down onto the
                    // child text element and leaves the row unidentified. This
                    // bites hardest on list rows, which is exactly what these
                    // are.
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier(AccessibilityIdentifier.sidebarItem(section))
            }
            .accessibilityIdentifier(AccessibilityIdentifier.sidebar)
            .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 320)
        } detail: {
            SectionDetailView(section: navigation.selection)
        }
        // No `.navigationTitle` on the split view itself: the detail pane owns
        // the title so the window title tracks the visible content, which is
        // what the proxy icon and window menu expect.
    }
}
