public import TaskNotesUniFFI

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
/// The routes are `linking.ts`'s, all of them: `today`, `inbox`, `upcoming`,
/// `browse`, `kanban`, `task/:taskId`, `project/:name`, `context/:name`,
/// `tag/:name`, `view/:id`, plus the five that name a command rather than a
/// screen — `quick-add`, `search`, `settings`, `pomodoro`, `time-report`.
/// Keeping them identical is what lets one bookmark, one Shortcuts action or
/// one note link work on the phone and on the Mac, and it is the reason the
/// entity routes are ported even though this app can also reach those screens
/// from a sidebar the phone does not have.
///
/// A route the Mac silently ignored would be worse than one it never claimed:
/// the link exists in the wild, the scheme is registered, and the user gets a
/// window that does nothing with no way to tell that from a broken bookmark. So
/// the parse is total over the published vocabulary — see ``TaskNotesAction``
/// for what each command route opens here and why it is a Mac surface rather
/// than the phone's screen.
///
/// `task/:taskId` is the route that most needs porting rather than the least:
/// a link into a note is how a task gets referred to from outside the app, and
/// the phone has published that spelling for as long as it has had deep links.
/// It resolves to a screen rather than to a pushed detail view — see
/// ``TaskNotesDestination/task(id:)``.
public struct TaskNotesURL: Equatable, Hashable, Sendable {
    /// The URL scheme this app claims. Must match `CFBundleURLSchemes`.
    public static let scheme = "tasknotes"

    /// Where the link goes, or what it asks for.
    public let target: TaskNotesLink

    public init(_ target: TaskNotesLink) {
        self.target = target
    }

    public init(_ destination: TaskNotesDestination) {
        self.init(.destination(destination))
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

    /// `tasknotes://task/Tasks%2Fplan.md`.
    public static func task(id: TaskId) -> TaskNotesURL {
        TaskNotesURL(.task(id: id))
    }

    /// `tasknotes://kanban`.
    public static let board = TaskNotesURL(.board)

    /// `tasknotes://quick-add`, `tasknotes://pomodoro`.
    public static func action(_ action: TaskNotesAction) -> TaskNotesURL {
        TaskNotesURL(.action(action))
    }

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
        guard let resolved = Self.link(host: host, component: Self.singleComponent(of: url))
        else { return nil }
        self.init(resolved)
    }

    /// Where a `host` plus its one optional path component goes.
    ///
    /// Split in two on whether the link carries an argument, which is a real
    /// distinction rather than a way of shortening a function: a host that
    /// takes no argument and is handed one is a link somebody built wrong, and
    /// answering it by ignoring the tail is the silent-fallback pattern this
    /// file exists to avoid. `tasknotes://today/anything` therefore resolves to
    /// nothing rather than to Today, and `tasknotes://settings/anything` to
    /// nothing rather than to Settings.
    private static func link(host: String, component: String?) -> TaskNotesLink? {
        guard let component else { return unargumented(host: host) }
        guard !component.isEmpty else { return nil }
        return named(host: host, name: component)
    }

    /// The hosts that are a whole link by themselves.
    ///
    /// The command hosts are matched from ``TaskNotesAction``'s raw values, so
    /// the enum is the list rather than a second copy of it. None of them can
    /// collide with a section or an entity kind — the round-trip test over
    /// `allCases` is what keeps that true as either side grows.
    private static func unargumented(host: String) -> TaskNotesLink? {
        if let section = SidebarSection(urlHost: host) { return .destination(.section(section)) }
        if host == boardHost { return .destination(.board) }
        if let action = TaskNotesAction(rawValue: host) { return .action(action) }
        return nil
    }

    /// The hosts that name something, given a non-empty name.
    private static func named(host: String, name: String) -> TaskNotesLink? {
        if host == savedViewHost { return .destination(.savedView(id: name)) }
        // The **core** decides what a task id is, in full: a vault-relative
        // markdown path or a `tmp-…` id, with `..`, a leading slash and a
        // backslash rejected. Anything on the machine can send this URL and the
        // id is joined onto the vault root downstream by code that does not
        // re-check, so a host-side "is it non-empty" test would be a second,
        // weaker rule sitting beside the real one.
        if host == taskHost { return parsedTaskId(name).map { .destination(.task(id: $0)) } }
        guard let kind = TaskEntity.Kind(rawValue: host),
            let entity = TaskEntity(kind: kind, name: name)
        else { return nil }
        return .destination(.entity(entity))
    }

    /// The canonical URL for this destination.
    ///
    /// Round-trips with ``init(_:)-(URL)``, which the tests assert over every
    /// destination — so a new one cannot be added with a link that does not
    /// resolve.
    public var url: URL {
        switch target {
        case .destination(let destination): Self.url(for: destination)
        case .action(let action): Self.build(host: action.rawValue, name: nil)
        }
    }

    private static func url(for destination: TaskNotesDestination) -> URL {
        switch destination {
        case .section(let section): build(host: section.urlHost, name: nil)
        case .board: build(host: boardHost, name: nil)
        case .savedView(let id): build(host: savedViewHost, name: id)
        case .task(let id): build(host: taskHost, name: id)
        case .entity(let entity): build(host: entity.kind.rawValue, name: entity.storedValue)
        }
    }

    // ── Components ─────────────────────────────────────────────────────────

    /// `kanban`, matching the React Native route. Not `board`, even though the
    /// screen is called the board, because the link vocabulary is shared and
    /// renaming half of it would break the half that already exists.
    private static let boardHost = "kanban"

    private static let savedViewHost = "view"

    /// `task`, matching the React Native `task/:taskId` route.
    private static let taskHost = "task"

    /// A task id the core accepts, or `nil`.
    ///
    /// The `nil` is not a swallowed error. This initializer's whole contract is
    /// that an unrecognized link produces no value — a malformed id arriving
    /// from another app is bad *input*, not a fault worth surfacing — and the
    /// caller already ignores a `nil`. `Result` rather than `try?`, which is
    /// banned here precisely because it hides which failure occurred; the
    /// failure is inspected and deliberately not kept.
    private static func parsedTaskId(_ raw: String) -> TaskId? {
        switch Result(catching: { try taskIdParse(raw: raw) }) {
        case .success(let id): id
        case .failure: nil
        }
    }

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
