/// The top-level destinations in the sidebar.
///
/// The React Native app models these as bottom tabs; on macOS they are the
/// source list of a `NavigationSplitView`. The enum lives here rather than in
/// the SwiftUI layer so that navigation state is testable without a GUI, and so
/// that the sidebar's ordering is one exhaustively-matched value rather than an
/// array literal duplicated across a view, a command menu, and a URL router.
///
/// Deliberately closed and deliberately without a `default:` anywhere it is
/// matched: adding a destination must be a compile error at every site that
/// cares, which is the whole reason `default:` is banned repository-wide.
public enum SidebarSection: String, CaseIterable, Sendable, Hashable, Codable {
    /// Tasks that have not been triaged.
    case inbox
    /// Everything due, scheduled, or overdue as of today.
    case today
    /// The forward-looking agenda.
    case upcoming
    /// The unfiltered corpus, with the full filter/sort/group surface.
    case browse

    /// The label shown in the source list and in the View menu.
    ///
    /// Hard-coded English, matching the TypeScript app, which hard-codes
    /// `en-US` throughout. Localization is a whole-app decision, not a
    /// per-string one, and is deliberately not started here.
    public var title: String {
        switch self {
        case .inbox: "Inbox"
        case .today: "Today"
        case .upcoming: "Upcoming"
        case .browse: "Browse"
        }
    }

    /// The SF Symbol name for the source-list row.
    ///
    /// A symbol *name* rather than an `Image` keeps this target free of
    /// SwiftUI — see the target's note in `Package.swift`.
    public var systemImage: String {
        switch self {
        case .inbox: "tray"
        case .today: "calendar.badge.clock"
        case .upcoming: "calendar"
        case .browse: "list.bullet.rectangle"
        }
    }

    /// The `tasknotes://` host that selects this section.
    ///
    /// `tasknotes://today` and friends. Parsing lives in
    /// ``SidebarSection/init(urlHost:)`` so that the URL vocabulary and the
    /// enum can never drift apart.
    public var urlHost: String { rawValue }

    /// Parses the host component of a `tasknotes://` URL.
    ///
    /// A failable initializer rather than a defaulting one: an unrecognized
    /// host is a routing bug or a stale link, and answering it by silently
    /// showing Inbox is the fallback-on-bad-data pattern the repository bans.
    /// Callers decide what a miss means.
    public init?(urlHost: String) {
        self.init(rawValue: urlHost.lowercased())
    }
}
