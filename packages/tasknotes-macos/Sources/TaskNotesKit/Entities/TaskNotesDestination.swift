public import TaskNotesUniFFI

/// Everything the detail pane can be showing.
///
/// ``SidebarSection`` was the whole of navigation while there were four
/// screens, and it stays the enumeration of the *top-level lists* — it is what
/// `⌘1`…`⌘4` count through, and adding a project to it would have made the
/// sidebar's fixed destinations and the vault's contents one list that no
/// longer has a stable order. This is the layer above: a destination is a
/// section, or a thing inside the vault, or the board.
///
/// Deliberately closed and deliberately matched without `default:` everywhere,
/// for the reason `SidebarSection` gives: adding a destination must be a
/// compile error at every site that routes one.
public enum TaskNotesDestination: Sendable, Equatable, Hashable, Codable {
    /// One of the four list screens.
    case section(SidebarSection)

    /// Every task filed under one project, context or tag.
    case entity(TaskEntity)

    /// A stored query, by id. The name and the query live in
    /// ``SavedViewStore``; only the id travels here, so a renamed view does not
    /// invalidate a window's restored selection or a deep link somebody saved.
    case savedView(id: SavedView.ID)

    /// The Kanban board.
    case board

    /// One task, revealed.
    ///
    /// The phone has a `TaskDetail` *screen* and this app deliberately does
    /// not — a task's fields live in the inspector, because selecting a row is
    /// not navigation. So the destination `tasknotes://task/…` resolves to is
    /// Browse, the one list that shows every task including finished ones, with
    /// that task selected; the selection publishes an `InspectorSubject` and
    /// the panel fills in. That is the same screen the user would have reached
    /// by finding the row themselves, which is what makes a link from a note
    /// and a click equivalent.
    ///
    /// The id travels rather than the task, exactly as ``savedView(id:)``
    /// carries an id: the store is the only thing that knows whether a task
    /// still exists, and a link that pre-validated would need a second copy of
    /// that knowledge in the router.
    case task(id: TaskId)

    /// Where a fresh window starts.
    public static let `default` = TaskNotesDestination.section(.today)

    /// A stable key for view identity and accessibility identifiers.
    ///
    /// The sections' keys are exactly their raw values, so
    /// ``AccessibilityIdentifier/detail(_:)-(TaskNotesDestination)`` produces
    /// the identifier the section overload already produced. That is a
    /// compatibility requirement, not a coincidence: the identifiers are what a
    /// UI test looks elements up by, and quietly renaming them would make an
    /// existing test find nothing while still passing.
    public var identity: String {
        switch self {
        case .section(let section): section.rawValue
        case .entity(let entity): entity.scope.identity
        case .savedView(let id): "view.\(id)"
        case .board: "board"
        case .task(let id): "task.\(id)"
        }
    }

    /// Whether this destination is one of the four fixed lists.
    ///
    /// Used by the sidebar to keep exactly one selection model across groups
    /// that hold different kinds of row.
    public var section: SidebarSection? {
        switch self {
        case .section(let section): section
        case .entity, .savedView, .board, .task: nil
        }
    }
}
