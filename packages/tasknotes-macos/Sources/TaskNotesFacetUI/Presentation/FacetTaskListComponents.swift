import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetSyncStatusBanners: View {
    let store: FacetStore

    var body: some View {
        if !store.hasConfiguredToken && !store.isIsolatedLaunch {
            HStack(spacing: 10) {
                Image(systemName: "wifi.slash")
                    .foregroundStyle(.orange)
                Text("Working locally in SQLite. Connect your Facet server to sync across devices.")
                    .font(.caption)
                Spacer()
                Button("Connect…") {
                    store.showsSettings = true
                }
                .controlSize(.small)
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier(AccessibilityIdentifier.SyncBanner.openSettings)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(.orange.opacity(0.10))
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
        let currentLayout = store.layout(forProject: projectId)
        HStack(spacing: 12) {
            if let proj {
                Circle()
                    .fill(FacetNativeStyle.swatchColor(proj.color))
                    .frame(width: 12, height: 12)
                Text(proj.name)
                    .font(.title2.weight(.bold))
                    .accessibilityIdentifier(AccessibilityIdentifier.TaskList.heading)
            }

            Spacer()

            Picker(
                "Layout",
                selection: Binding(
                    get: { currentLayout },
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

            Button {
                onPresentModal(.addSection(projectId: projectId))
            } label: {
                Label("Add Section", systemImage: "rectangle.split.3x1.fill")
            }
            .controlSize(.small)

            if let proj, !proj.is_inbox {
                projectOverflowMenu(proj)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 8)
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
            HStack {
                Text(group.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(group.isOverdue ? .red : .primary)
                Text("\(group.tasks.count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
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
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.group(group.title))

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

internal struct FacetUpcomingWeekStripView: View {
    let store: FacetStore

    var body: some View {
        HStack(spacing: 8) {
            ForEach(store.upcomingWeekSlots) { slot in
                let selected = store.upcomingSelectedDayOffset == slot.offset
                Button {
                    store.upcomingSelectedDayOffset = slot.offset
                } label: {
                    VStack(spacing: 4) {
                        Text(slot.weekdayShort)
                            .font(.caption2)
                            .foregroundStyle(selected ? .white : .secondary)
                        Text(slot.dayNumber)
                            .font(.headline)
                            .foregroundStyle(selected ? .white : .primary)
                        Circle()
                            .fill(
                                slot.taskCount > 0
                                    ? (selected ? Color.white : FacetNativeStyle.brand)
                                    : Color.clear
                            )
                            .frame(width: 5, height: 5)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(
                        selected ? FacetNativeStyle.brand : Color.secondary.opacity(0.08),
                        in: .rect(cornerRadius: 10)
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }
}
