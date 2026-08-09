public import struct Foundation.URL

/// A parsed `tasknotes://` deep link.
///
/// The app registers the scheme (see `App/Info.plist`), so anything on the
/// machine can hand it a URL — including a malicious one. Parsing therefore
/// lives here, in a target with no UI, so it is exercised headlessly and so the
/// SwiftUI layer only ever receives a value that has already been validated.
///
/// Parse, don't validate: a `TaskNotesURL` value cannot exist unless the URL
/// was well-formed, so no downstream code re-checks it.
public enum TaskNotesURL: Equatable, Hashable, Sendable {
    /// The URL scheme this app claims. Must match `CFBundleURLSchemes`.
    public static let scheme = "tasknotes"

    /// `tasknotes://today` — select a sidebar destination.
    case section(SidebarSection)

    /// Parses a URL, returning `nil` when it is not a link this app handles.
    ///
    /// Failable rather than throwing, and deliberately not defaulting: an
    /// unrecognized link is not an error worth surfacing to the user, but it is
    /// also not a reason to silently open some arbitrary screen. The caller
    /// ignores a `nil`.
    ///
    /// Case handling matches the platform: schemes and hosts are compared
    /// lowercased, because macOS does not guarantee the case it hands over.
    public init?(_ url: URL) {
        guard url.scheme?.lowercased() == Self.scheme else { return nil }
        // `URL.host()` is nil for `tasknotes:///today`-style URLs and for
        // opaque ones; both are malformed for this scheme.
        guard let host = url.host(), let section = SidebarSection(urlHost: host) else {
            return nil
        }
        self = .section(section)
    }

    /// The canonical URL for this destination.
    ///
    /// Round-trips with ``init(_:)``, which the tests assert over every case —
    /// so a new destination cannot be added with a link that does not resolve.
    public var url: URL {
        switch self {
        case .section(let section):
            guard let resolved = URL(string: "\(Self.scheme)://\(section.urlHost)") else {
                // Unreachable: `urlHost` is an ASCII identifier from a closed
                // enum. A contract violation here is a broken invariant in
                // `SidebarSection`, not bad input, so it must be loud rather
                // than answered with a placeholder.
                preconditionFailure("SidebarSection.urlHost is not URL-safe: \(section.urlHost)")
            }
            return resolved
        }
    }
}
