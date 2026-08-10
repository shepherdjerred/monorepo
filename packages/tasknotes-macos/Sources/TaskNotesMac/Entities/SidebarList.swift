internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// The window's source list.
///
/// ## Why the vault is in the sidebar at all
///
/// On the phone, a project screen is reached by tapping a project chip on a
/// task, or by a `tasknotes://project/…` link. There is nowhere else to put it:
/// one column, five tabs. A Mac window has a source list, and a source list is
/// where Finder puts your folders and Mail puts your mailboxes — so the vault's
/// projects, contexts and tags belong in it, and the three "detail screens"
/// stop being screens you can only arrive at sideways.
///
/// Each group is a `Section`, which macOS draws with its own disclosure
/// triangle, so a vault with two hundred projects collapses to one line. The
/// names come from ``TaskVocabulary`` — the same first-appearance order the
/// inspector's token fields complete against, deliberately unsorted for the
/// reason that type gives at length.
///
/// ## One selection across five groups
///
/// `List` takes exactly one selection type, which is why ``NavigationState``
/// holds a ``TaskNotesDestination`` rather than a ``SidebarSection``: a sidebar
/// that lists sections, saved views, the board *and* the vault's own names
/// cannot have four selection models. `SidebarSection` still enumerates the
/// four fixed screens, which is what `⌘1`…`⌘4` count through.
struct SidebarList: View {
    @Bindable var navigation: NavigationState

    /// The vault's projects, contexts and tags.
    let vocabulary: TaskVocabulary

    let savedViews: SavedViewStore

    /// The frontmost screen's query, so the Views group's `+` can keep it.
    ///
    /// Read as a focused value rather than passed in: the query lives in the
    /// detail pane and the control that saves it lives here, and
    /// `focusedSceneValue` is the seam the menu bar already uses to cross that
    /// gap. `nil` means there is no list in front of the reader, which renders
    /// as a disabled button rather than an absent one.
    @FocusedValue(\.taskListActions) private var actions: TaskListActions?

    /// The sheet, when one is open.
    @State private var editor: SavedViewEditor.Mode?

    var body: some View {
        List(selection: $navigation.selection) {
            Section {
                ForEach(SidebarSection.allCases, id: \.self) { section in
                    row(
                        section.title,
                        systemImage: section.systemImage,
                        destination: .section(section)
                    )
                }
                row("Board", systemImage: "rectangle.split.3x1", destination: .board)
            }

            Section {
                ForEach(savedViews.views) { view in
                    row(
                        view.name,
                        systemImage: view.symbol.systemImage,
                        destination: .savedView(id: view.id)
                    )
                    .contextMenu { savedViewMenu(view) }
                }
                if savedViews.views.isEmpty {
                    // Drawn `.tertiary` because it is a placeholder rather than
                    // a row — that de-emphasis is the difference between "no
                    // views" and "a view called None yet". A reader gets the
                    // same distinction from the label, which says which group
                    // is empty; two words on their own do not.
                    Text("None yet")
                        .font(.callout)
                        // See the note on the entity groups below.
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("No saved views yet")
                }
            } header: {
                viewsHeader
            }

            ForEach(TaskEntity.Kind.allCases, id: \.self) { kind in
                entityGroup(kind)
            }
        }
        // `.contain`: every row inside keeps its own identifier and its own
        // selection behaviour. The label is what stops the audit reporting an
        // undescribed container once the modifier makes this a real element.
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Sidebar")
        .accessibilityIdentifier(AccessibilityIdentifier.sidebar)
        .sheet(item: $editor) { mode in
            SavedViewEditor(mode: mode, store: savedViews)
        }
        // A failure reading the stored views is the one thing about this
        // sidebar worth interrupting for: the rows are simply absent
        // otherwise, which is indistinguishable from never having made any.
        .alert(
            "Your saved views could not be read",
            isPresented: Binding(
                get: { savedViews.lastError != nil },
                set: { if !$0 { savedViews.clearError() } }
            )
        ) {
            Button("OK") { savedViews.clearError() }
        } message: {
            Text(savedViews.lastError?.userMessage ?? "")
        }
    }

    /// The Views heading, and the control that keeps the current query.
    ///
    /// **Disabled, never hidden**, and now disabled for exactly one reason:
    /// there is no list in front of you. It used to grey out on any screen that
    /// already carried a scope — a project, a tag, another saved view — because
    /// two sequential filters could not be stored as the one `FilterConfig` a
    /// view held. The core's `FilterChain` removed that restriction; see
    /// ``TaskListActions/saveableView``.
    private var viewsHeader: some View {
        HStack {
            Text("Views")
            Spacer()
            Button {
                guard let draft = actions?.saveableView else { return }
                editor = .create(draft)
            } label: {
                Image(systemName: "plus")
            }
            .buttonStyle(.borderless)
            .disabled(actions == nil)
            .help("Keep the current list as a saved view")
            .accessibilityLabel("New Saved View")
            .accessibilityIdentifier(AccessibilityIdentifier.SavedViews.save)
        }
        // ⚠️ `.contain`, and `.combine` would be a real loss here: this header
        // holds the only control that makes a saved view. Without the modifier
        // the header collapsed into a single `StaticText` reading
        // *"Views, New Saved View"* — the button's words with none of its
        // button — so the control was unreachable by keyboard, by VoiceOver and
        // by a UI test at once.
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Views")
        .accessibilityIdentifier(AccessibilityIdentifier.sidebarGroup("views"))
    }

    @ViewBuilder
    private func savedViewMenu(_ view: SavedView) -> some View {
        Button("Rename…", systemImage: "pencil") { editor = .edit(view) }
        Button("Delete", systemImage: "trash", role: .destructive) {
            // If the deleted view is what the window is showing, the detail
            // pane says so rather than the sidebar silently retargeting: a
            // selection that moved on its own is harder to explain than a
            // screen that states what happened.
            savedViews.remove(id: view.id)
        }
        .accessibilityIdentifier(AccessibilityIdentifier.SavedViews.delete)
        Divider()
        Button("Restore Default Views") { savedViews.restoreDefaults() }
            .accessibilityIdentifier(AccessibilityIdentifier.SavedViews.restoreDefaults)
    }

    /// One group of the vault's own names.
    ///
    /// **Present and empty rather than absent.** A vault with no contexts still
    /// gets a Contexts heading, because a sidebar that changes shape as data
    /// arrives teaches nobody where anything lives — the same rule the filter
    /// menu's greyed-out dimensions already follow.
    @ViewBuilder
    private func entityGroup(_ kind: TaskEntity.Kind) -> some View {
        let entities = vocabulary.entities(of: kind)
        Section {
            ForEach(entities, id: \.self) { entity in
                // `sidebarTitle` draws, `title` speaks. The row's icon is
                // already an `@` or a `#`, so drawing the sigil again gives
                // `@ @work` — while a VoiceOver reader hears only "work",
                // which is ambiguous across all three kinds at once.
                row(
                    entity.sidebarTitle,
                    systemImage: kind.systemImage,
                    destination: .entity(entity),
                    spoken: entity.title
                )
            }
            if entities.isEmpty {
                // Same placeholder treatment as the Views group above, and the
                // same reason for naming the group in the label: three
                // identical "None yet" rows down one sidebar say nothing at all
                // to a reader who cannot see which heading each sits under.
                Text("None yet")
                    .font(.callout)
                    // `.secondary`, not `.tertiary`: the audit reports
                    // tertiary-on-sidebar as failing contrast, and unlike the
                    // dimmed row marks this is not de-emphasis that means
                    // anything — it is placeholder text nobody chose to mute.
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("No \(kind.groupTitle.lowercased()) yet")
            }
        } header: {
            // `.combine` on a header that is one word: it collapses the group
            // wrapper `List` puts around header content — an element with no
            // description of its own — into the text itself.
            Text(kind.groupTitle)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(kind.groupTitle)
                .accessibilityIdentifier(
                    AccessibilityIdentifier.sidebarGroup(kind.rawValue))
        }
    }

    /// One selectable row.
    ///
    /// ⚠️ `.accessibilityElement(children: .combine)` **before** the identifier.
    /// A `Label` is a container, and an identifier applied to one without
    /// combining lands on the child text and leaves the row itself
    /// unidentified — the trap the plan calls out and the one that bites
    /// hardest on list rows, which is all of these.
    /// - Parameters:
    ///   - title: what the row draws.
    ///   - systemImage: the SF Symbol beside it.
    ///   - destination: what selecting the row shows, and what identifies it.
    ///   - spoken: what VoiceOver says, when that differs from what is drawn.
    ///     `nil` means the two are the same, which is the common case.
    /// - Returns: the row, tagged with its destination so the enclosing `List`
    ///   can select it.
    private func row(
        _ title: String,
        systemImage: String,
        destination: TaskNotesDestination,
        spoken: String? = nil
    ) -> some View {
        Label(title, systemImage: systemImage)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(spoken ?? title)
            .accessibilityIdentifier(AccessibilityIdentifier.sidebarItem(destination))
            .tag(destination)
    }
}
