import SwiftUI
import TaskNotesKit

/// Independent column scrolling keeps every loaded card reachable without moving pagination away.
internal struct FacetNativeBoard<Card: View>: View {
    let snapshot: FacetSnapshot
    let statuses: [FacetConfiguredChoice]
    let isLoading: Bool
    let captureClearance: CGFloat
    let loadMore: () -> Void
    let acceptDrop: ([FacetBoardDragItem], String) -> Bool
    @ViewBuilder let card: (FacetTask) -> Card

    var body: some View {
        VStack(spacing: 0) {
            pagination
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    ForEach(statuses) { status in
                        column(status)
                    }
                }
                .padding()
                .frame(maxHeight: .infinity, alignment: .top)
            }
        }
    }

    private var pagination: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                loadedCount
                Spacer()
                loadMoreButton
            }
            VStack(alignment: .leading, spacing: 4) {
                loadedCount
                loadMoreButton
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("facet.board.pagination")
    }

    private var loadedCount: some View {
        Text("\(snapshot.tasks.count) of \(snapshot.totalCount) tasks loaded")
            .font(.subheadline).foregroundStyle(.secondary)
            .accessibilityIdentifier("facet.board.loadedCount")
    }

    @ViewBuilder private var loadMoreButton: some View {
        if snapshot.totalCount > UInt64(snapshot.tasks.count) {
            Button("Load more tasks", action: loadMore)
                .frame(minHeight: 44)
                .disabled(isLoading)
                .accessibilityIdentifier("facet.board.loadMore")
        }
    }

    private func column(_ status: FacetConfiguredChoice) -> some View {
        let tasks = snapshot.tasks.filter { $0.status == status.value }
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Circle().fill(FacetNativeStyle.tint(status)).frame(width: 8, height: 8)
                Text(status.label).font(.headline)
                Spacer()
                Text("\(tasks.count) loaded").font(.caption).foregroundStyle(.secondary)
            }
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(tasks, id: \.rowID) { task in
                        card(task)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentMargins(.bottom, captureClearance, for: .scrollContent)
            .accessibilityIdentifier("facet.board.cards.\(status.value)")
        }
        .padding(12).frame(width: 280)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("facet.board.column.\(status.value)")
        .dropDestination(for: FacetBoardDragItem.self) { items, _ in
            acceptDrop(items, status.value)
        }
    }
}
