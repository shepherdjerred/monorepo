// `URL` is public because it is this type's whole surface; `CharacterSet`
// follows it, because Swift requires every import of a module within one file
// to agree on its access level.
public import struct Foundation.CharacterSet
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
///
/// ## One vocabulary, shared with the React Native app
///
/// The routes are `linking.ts`'s: `today`, `inbox`, `upcoming`, `browse`,
/// `kanban`, `project/:name`, `context/:name`, `tag/:name`, `view/:id`. Keeping
/// them identical is what lets one bookmark, one Shortcuts action or one note
/// link work on the phone and on the Mac, and it is the reason the entity
/// routes are ported even though this app can also reach those screens from a
/// sidebar the phone does not have.
public struct TaskNotesURL: Equatable, Hashable, Sendable {
    /// The URL scheme this app claims. Must match `CFBundleURLSchemes`.
    public static let scheme = "tasknotes"

    /// Where the link goes.
    public let destination: TaskNotesDestination

    public init(_ destination: TaskNotesDestination) {
        self.destination = destination
    }

    /// `tasknotes://today` — select a sidebar destination.
    ///
    /// A factory rather than an enum case, because the enumeration of
    /// destinations lives on ``TaskNotesDestination`` and having two parallel
    /// closed enums would mean adding every future destination twice.
    public static func section(_ section: SidebarSection) -> TaskNotesURL {
        TaskNotesURL(.section(section))
    }

    /// `tasknotes://project/Website`, `tasknotes://tag/release`.
    public static func entity(_ entity: TaskEntity) -> TaskNotesURL {
        TaskNotesURL(.entity(entity))
    }

    /// `tasknotes://view/job-search`.
    public static func savedView(id: SavedView.ID) -> TaskNotesURL {
        TaskNotesURL(.savedView(id: id))
    }

    /// `tasknotes://kanban`.
    public static let board = TaskNotesURL(.board)

    /// Parses a URL, returning `nil` when it is not a link this app handles.
    ///
    /// Failable rather than throwing, and deliberately not defaulting: an
    /// unrecognized link is not an error worth surfacing to the user, but it is
    /// also not a reason to silently open some arbitrary screen. The caller
    /// ignores a `nil`.
    ///
    /// Case handling matches the platform: schemes and hosts are compared
    /// lowercased, because macOS does not guarantee the case it hands over. The
    /// **path is not lowercased** — a project is called what the vault calls it,
    /// and folding its case would send `tasknotes://project/Website` to a
    /// project named `website` that may or may not exist.
    public init?(_ url: URL) {
        guard url.scheme?.lowercased() == Self.scheme else { return nil }
        // `URL.host()` is nil for `tasknotes:///today`-style URLs and for
        // opaque ones; both are malformed for this scheme.
        guard let host = url.host()?.lowercased() else { return nil }

        let name = Self.singleComponent(of: url)

        if let section = SidebarSection(urlHost: host) {
            // A section takes no argument. `tasknotes://today/anything` is a
            // link somebody built wrong, and answering it by ignoring the tail
            // is the silent-fallback pattern this file exists to avoid.
            guard name == nil else { return nil }
            self.init(.section(section))
            return
        }

        if host == Self.boardHost {
            guard name == nil else { return nil }
            self.init(.board)
            return
        }

        guard let name, !name.isEmpty else { return nil }

        if host == Self.savedViewHost {
            self.init(.savedView(id: name))
            return
        }

        guard let kind = TaskEntity.Kind(rawValue: host),
            let entity = TaskEntity(kind: kind, name: name)
        else { return nil }
        self.init(.entity(entity))
    }

    /// The canonical URL for this destination.
    ///
    /// Round-trips with ``init(_:)-(URL)``, which the tests assert over every
    /// destination — so a new one cannot be added with a link that does not
    /// resolve.
    public var url: URL {
        switch destination {
        case .section(let section): Self.build(host: section.urlHost, name: nil)
        case .board: Self.build(host: Self.boardHost, name: nil)
        case .savedView(let id): Self.build(host: Self.savedViewHost, name: id)
        case .entity(let entity):
            Self.build(host: entity.kind.rawValue, name: entity.storedValue)
        }
    }

    // ── Components ─────────────────────────────────────────────────────────

    /// `kanban`, matching the React Native route. Not `board`, even though the
    /// screen is called the board, because the link vocabulary is shared and
    /// renaming half of it would break the half that already exists.
    private static let boardHost = "kanban"

    private static let savedViewHost = "view"

    /// The one path component a link carries, or `nil` when it carries none.
    ///
    /// Rejects two or more: `tasknotes://project/a/b` is not a project called
    /// `a/b` — that spelling is `a%2Fb`, which is what ``build(host:name:)``
    /// emits — so accepting it would make two different links mean one thing.
    ///
    /// Read from `path(percentEncoded: true)` and decoded here rather than from
    /// `pathComponents`, which decodes before splitting and would therefore
    /// turn an encoded `%2F` inside a name back into a separator.
    private static func singleComponent(of url: URL) -> String? {
        let raw = url.path(percentEncoded: true)
        guard raw.hasPrefix("/") else { return nil }
        let components = raw.dropFirst().split(separator: "/", omittingEmptySubsequences: false)
        guard components.count == 1, let only = components.first else { return nil }
        return String(only).removingPercentEncoding
    }

    private static func build(host: String, name: String?) -> URL {
        var text = "\(scheme)://\(host)"
        if let name {
            text += "/\(encoded(name))"
        }
        guard let resolved = URL(string: text) else {
            // Unreachable: the host is an ASCII identifier from a closed enum
            // and the name has just been percent-encoded. A failure here is a
            // broken invariant rather than bad input, so it must be loud rather
            // than answered with a placeholder.
            preconditionFailure("a tasknotes:// link is not URL-safe: \(text)")
        }
        return resolved
    }

    /// One path component, encoded so that nothing in it can be read as
    /// structure.
    ///
    /// ⚠️ `CharacterSet.urlPathAllowed` **permits `/`**, which is exactly wrong
    /// for a single component: a project stored as `[[Areas/Work]]` would
    /// otherwise emit a two-component path and parse back as something else.
    /// The plan records this trap costing a test to find on the wire layer;
    /// this is the same trap, one layer up.
    private static func encoded(_ name: String) -> String {
        guard let encoded = name.addingPercentEncoding(withAllowedCharacters: componentAllowed)
        else {
            preconditionFailure("a link component could not be percent-encoded: \(name)")
        }
        return encoded
    }

    private static let componentAllowed: CharacterSet = {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return allowed
    }()
}
