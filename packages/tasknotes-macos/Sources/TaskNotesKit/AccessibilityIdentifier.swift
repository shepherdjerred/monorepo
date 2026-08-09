/// Namespaced accessibility identifiers for every interactive element.
///
/// These live in `TaskNotesKit` on purpose: the SwiftUI layer and the XCUITest
/// target both import this module, so renaming an identifier is a compile error
/// in the UI test rather than a test that quietly stops finding its element and
/// then quietly stops asserting anything.
///
/// The namespace prefix keeps them distinguishable from AppKit-supplied
/// identifiers in accessibility inspectors and in `performAccessibilityAudit()`
/// output.
public enum AccessibilityIdentifier {
    private static let namespace = "red.sjer.tasknotes"

    /// The `NavigationSplitView` source list itself.
    public static let sidebar = "\(namespace).sidebar"

    /// A source-list row. One identifier per destination, derived from the enum
    /// so a new destination cannot ship without one.
    public static func sidebarItem(_ section: SidebarSection) -> String {
        "\(namespace).sidebar.\(section.rawValue)"
    }

    /// The detail pane for a destination.
    public static func detail(_ section: SidebarSection) -> String {
        "\(namespace).detail.\(section.rawValue)"
    }

    /// The Settings window's root.
    public static let settings = "\(namespace).settings"
}
