/// What a `tasknotes://` link asks for.
///
/// Most of the published vocabulary names a **place**: `today` selects a
/// section, `task/…` reveals a task, `view/…` opens a saved query. Five of the
/// hosts the React Native app publishes name a **thing to do** instead —
/// quick-add, search, settings, the pomodoro timer and the time report are
/// commands or auxiliary windows, not detail-pane contents.
///
/// Those five are deliberately *not* cases on ``TaskNotesDestination``. That
/// enum is "everything the detail pane can be showing", it is matched without
/// `default:` at every routing site, and it is what a window's restored
/// selection is persisted as — so a `settings` case would have made every one
/// of those sites answer a question it has no answer to, and would have let a
/// window be restored into a state it cannot render. Splitting the two kinds
/// here keeps each closed enum honest and still makes adding a route a compile
/// error everywhere it has to be handled.
public enum TaskNotesLink: Sendable, Equatable, Hashable {
    /// A place: what the window should be showing.
    case destination(TaskNotesDestination)

    /// A thing to do: a panel, a focus move, a scene to open.
    case action(TaskNotesAction)
}

/// The `tasknotes://` hosts that name a command rather than a screen.
///
/// ## Why the Mac answers routes the phone invented
///
/// These five are already published: `linking.ts` has registered `quick-add`,
/// `search`, `settings`, `pomodoro` and `time-report` for as long as the phone
/// has had deep links, so they are in bookmarks, in Shortcuts actions and in
/// links inside notes. A link vocabulary that half the clients ignore is worse
/// than no vocabulary at all — the same reasoning that brought the entity
/// routes across even though the Mac reaches those screens from a sidebar.
///
/// ## What each one resolves to here, and why it is not the phone's screen
///
/// The *route* is shared; the surface it opens is the platform's. `search`
/// pushes a whole screen on a phone, because a phone has one column and no room
/// for a field beside a title; on the Mac it puts the caret in the toolbar's
/// search field, which is what `⌘F` already does and what every Mac application
/// answers. `settings`, `pomodoro` and `time-report` are windows here rather
/// than pushed routes. `quick-add` is a floating non-activating panel. Each is a
/// surface the app already has — a link that opened a second, link-only copy of
/// any of them would be the drift this shared vocabulary exists to prevent.
///
/// The raw values *are* the hosts, so the enum and the URL spelling cannot
/// drift, and the round-trip test drives off `allCases` — a sixth action cannot
/// ship without a link that resolves.
public enum TaskNotesAction: String, CaseIterable, Sendable, Equatable, Hashable, Codable {
    /// Summon the floating quick-add panel.
    case quickAdd = "quick-add"

    /// Put the caret in the frontmost list's search field.
    case search

    /// Open the Settings window — the same one `⌘,` opens.
    case settings

    /// Open the pomodoro timer window.
    case pomodoro

    /// Open the time report window.
    case timeReport = "time-report"
}
