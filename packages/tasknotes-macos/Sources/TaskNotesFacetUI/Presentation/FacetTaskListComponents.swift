import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetFlatListSpec {
    let heading: String
    let subtitle: String
    let tasks: [Task]
    let showProjectBadge: Bool
    var allowInlineCompose: Bool = true
    let emptyTitle: String
    let emptyMessage: String
}

internal struct FacetGroupedListSpec {
    let heading: String?
    let subtitle: String?
    let groups: [FacetTaskGroup]
    let showProjectBadge: Bool
    let showWeekStrip: Bool
    let projectIdForSections: String?
    let emptyTitle: String
    let emptyMessage: String
}

internal struct FacetSyncStatusBanners: View {
    let store: FacetStore

    var body: some View {
        if !store.hasConfiguredToken && !store.isIsolatedLaunch {
            HStack(spacing: 10) {
                Image(systemName: "wifi.slash")
                    .foregroundStyle(.secondary)
                Text("Working offline")
                    .font(.caption)
                Spacer()
                Button("Connect…") {
                    store.showsSettings = true
                }
                .controlSize(.small)
                .buttonStyle(.borderless)
                .accessibilityIdentifier(AccessibilityIdentifier.SyncBanner.openSettings)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(.quinary)
            .accessibilityIdentifier(AccessibilityIdentifier.SyncBanner.banner)
        } else if let errorText = store.effectiveError {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                Text(errorText)
                    .font(.caption)
                    .lineLimit(2)
                Spacer()
                Button("Retry") {
                    _Concurrency.Task { await store.syncNow() }
                }
                .controlSize(.small)
                .accessibilityIdentifier(AccessibilityIdentifier.SyncBanner.retry)
                Button("Dismiss") {
                    store.clearError()
                }
                .controlSize(.small)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(.red.opacity(0.10))
            .accessibilityIdentifier(AccessibilityIdentifier.SyncBanner.banner)
        }
    }
}

internal struct FacetProjectHeaderBar: View {
    let projectId: String
    let store: FacetStore
    let onPresentModal: (FacetPresentedEntityModal) -> Void

    var body: some View {
        let proj = store.project(for: projectId)
        Group {
            #if os(iOS)
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        projectTitle(proj)
                        Spacer()
                        if let proj, !proj.is_inbox { projectOverflowMenu(proj) }
                    }
                    HStack {
                        layoutPicker
                        Spacer()
                        addSection
                    }
                }
            #else
                HStack(spacing: 12) {
                    projectTitle(proj)
                    Spacer()
                    layoutPicker
                    addSection
                    if let proj, !proj.is_inbox { projectOverflowMenu(proj) }
                }
            #endif
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private func projectTitle(_ project: Project?) -> some View {
        if let project {
            Circle().fill(FacetNativeStyle.swatchColor(project.color)).frame(width: 12, height: 12)
            Text(project.name)
                .font(.title2.bold())
                .focusable()
                .modifier(FacetTaskFocus(target: .heading))
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.heading)
        }
    }

    private var layoutPicker: some View {
        Picker(
            "Layout",
            selection: Binding(
                get: { store.layout(forProject: projectId) },
                set: { store.setLayout($0, forProject: projectId) }
            )
        ) {
            ForEach(FacetProjectLayout.allCases, id: \.self) { mode in
                Label(mode.title, systemImage: mode.systemImage).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(maxWidth: 150)
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.viewMode)
    }

    private var addSection: some View {
        Button {
            onPresentModal(.addSection(projectId: projectId))
        } label: {
            Label("Add Section", systemImage: "plus")
        }
        .controlSize(.small)
    }

    private func projectOverflowMenu(_ proj: Project) -> some View {
        Menu {
            Button("Edit Project…") {
                onPresentModal(.editProject(proj))
            }
            Button(proj.is_favorite ? "Remove from Favorites" : "Add to Favorites") {
                store.toggleProjectFavorite(proj)
            }
            Divider()
            Button("Delete Project", role: .destructive) {
                store.deleteProject(id: proj.id)
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .menuStyle(.borderlessButton)
        .frame(width: 28)
    }
}

internal struct FacetTaskGroupSectionView: View {
    let group: FacetTaskGroup
    let showProjectBadge: Bool
    let store: FacetStore
    let onSelectTask: (Task) -> Void
    let onPresentModal: (FacetPresentedEntityModal) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            FacetTaskGroupHeader(group: group, store: store, onPresentModal: onPresentModal)

            Divider()

            if group.tasks.isEmpty {
                Text("No tasks in \(group.title)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 4)
            } else {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(group.tasks) { task in
                        FacetTaskRowView(
                            task: task,
                            store: store,
                            showProjectBadge: showProjectBadge,
                            isSelected: store.selectedTaskId == task.id,
                            onSelect: { onSelectTask(task) }
                        )
                        Divider()
                    }
                }
            }
        }
    }
}

internal struct FacetTaskGroupHeader: View {
    let group: FacetTaskGroup
    let store: FacetStore
    let onPresentModal: (FacetPresentedEntityModal) -> Void

    var body: some View {
        HStack {
            Text(group.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(group.isOverdue ? .red : .primary)
                .accessibilityAddTraits(.isHeader)
            Text(group.tasks.count == 1 ? "1 task" : "\(group.tasks.count) tasks")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            if group.civilDate != nil || group.sectionId != nil {
                Button(action: openCapture) {
                    Image(systemName: "plus")
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Add task")
                .buttonStyle(.borderless)
            }
            if let secId = group.sectionId, let sectionObj = store.section(for: secId) {
                Menu {
                    Button("Rename Section…") {
                        onPresentModal(.renameSection(sectionObj))
                    }
                    Button("Delete Section", role: .destructive) {
                        store.deleteSection(id: sectionObj.id)
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .foregroundStyle(.secondary)
                }
                .menuStyle(.borderlessButton)
                .frame(width: 24)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.group(group.title))
        .facetCaptureTarget(
            group.civilDate.map(FacetCaptureTarget.day)
                ?? group.sectionId.map(FacetCaptureTarget.section))
    }

    private func openCapture() {
        if let civil = group.civilDate { store.upcomingSelectedDate = civil }
        store.captureSectionId = group.sectionId
        store.showsCapture = true
    }
}
