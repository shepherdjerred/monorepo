import Foundation
import SwiftUI
import TaskNotesKit

#if os(macOS)
    import AppKit
#else
    import UIKit
#endif

internal enum FacetNativeStyle {
    static let tokens = FacetPresentationTokens.shared
    static var formMinimumWidth: CGFloat? {
        #if os(macOS)
            340
        #else
            nil
        #endif
    }
    static var text: Color {
        #if os(macOS)
            Color(nsColor: .labelColor)
        #else
            Color(uiColor: .label)
        #endif
    }
    static var secondaryText: Color {
        #if os(macOS)
            Color(nsColor: .secondaryLabelColor)
        #else
            Color(uiColor: .secondaryLabel)
        #endif
    }
    static var brand: Color {
        #if os(iOS)
            .indigo
        #else
            .accentColor
        #endif
    }

    static func tint(_ choice: FacetConfiguredChoice) -> Color {
        guard let value = choice.color, let color = FacetConfiguredColor(value) else {
            return .secondary
        }
        return Color(
            .sRGB, red: color.red, green: color.green, blue: color.blue, opacity: color.alpha)
    }

    static var rowAnimation: Animation {
        .snappy(duration: tokens.motion.milliseconds.rowChange / 1000)
    }
}

internal struct FacetTaskRow: View {
    let task: FacetTask
    let presentation: FacetTaskPresentation
    let desktop: Bool
    var stacked = false
    let complete: () -> Void
    let open: () -> Void
    let schedule: () -> Void
    let delete: () -> Void
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @Environment(\.dynamicTypeSize) private var dynamicType
    @ScaledMetric(relativeTo: .body) private var checkboxSize = CGFloat(
        FacetNativeStyle.tokens.mobile.checkboxSize)

    var body: some View {
        HStack(
            alignment: desktop ? .firstTextBaseline : .center,
            spacing: CGFloat(FacetNativeStyle.tokens.spacing.sm)
        ) {
            Button(action: complete) {
                if reducedMotion || desktop {
                    checkbox
                } else {
                    checkbox.phaseAnimator(
                        [1.0, FacetNativeStyle.tokens.motion.checkboxSpring.peakScale, 1.0],
                        trigger: task.completed
                    ) { content, phase in
                        content.scaleEffect(phase)
                    } animation: { _ in
                        .interpolatingSpring(
                            stiffness: FacetNativeStyle.tokens.motion.checkboxSpring.stiffness,
                            damping: FacetNativeStyle.tokens.motion.checkboxSpring.damping)
                    }
                }
            }
            .buttonStyle(.plain)
            .frame(
                minWidth: CGFloat(
                    desktop
                        ? FacetNativeStyle.tokens.hitTargets.desktop
                        : FacetNativeStyle.tokens.hitTargets.mobile),
                minHeight: CGFloat(
                    desktop
                        ? FacetNativeStyle.tokens.hitTargets.desktop
                        : FacetNativeStyle.tokens.hitTargets.mobile)
            )
            .accessibilityLabel(
                task.completed ? "Uncomplete \(task.title)" : "Complete \(task.title)")

            if desktop && !stacked {
                Text(task.title).lineLimit(1).layoutPriority(2)
                    .strikethrough(task.completed).foregroundStyle(
                        task.completed ? .secondary : .primary)
                if let weight = presentation.priority.weight, weight > 0 {
                    Image(systemName: "exclamationmark").foregroundStyle(
                        FacetNativeStyle.tint(presentation.priority)
                    )
                    .help(presentation.priority.label).accessibilityHidden(true)
                }
                markers
                if !presentation.metadata.isEmpty {
                    Text(presentation.metadata).font(.caption).foregroundStyle(
                        FacetNativeStyle.secondaryText
                    )
                    .lineLimit(1).layoutPriority(1)
                }
                Spacer(minLength: 8)
                date.frame(
                    minWidth: CGFloat(FacetNativeStyle.tokens.desktop.dateColumnMin),
                    alignment: .leading)
                HStack(spacing: 4) {
                    Button(action: schedule) { Image(systemName: "calendar") }
                    Button(action: delete) { Image(systemName: "trash") }
                }.buttonStyle(.borderless).opacity(hovering ? 1 : 0)
            } else {
                Button(action: open) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(task.title).font(.body).multilineTextAlignment(.leading)
                            .strikethrough(task.completed).foregroundStyle(
                                task.completed ? .secondary : .primary)
                        rowMetadata.font(.caption)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.buttonStyle(.plain).accessibilityHint("View task details")
            }
        }
        .padding(
            .vertical,
            CGFloat(
                desktop
                    ? FacetNativeStyle.tokens.desktop.rowVerticalPadding
                    : FacetNativeStyle.tokens.mobile.rowVerticalPadding)
        )
        .onHover { hovering = $0 }
        .contentShape(Rectangle())
        .contextMenu {
            Button(task.completed ? "Uncomplete" : "Complete", action: complete)
            Button("Schedule…", action: schedule)
            Button("Edit…", action: open)
            Button("Delete task", role: .destructive, action: delete)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("facet.task.\(task.path)")
    }

    @ViewBuilder private var rowMetadata: some View {
        if !desktop && dynamicType.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4) {
                date
                metadataText
                HStack(spacing: 6) { markers }
            }.frame(maxWidth: .infinity, alignment: .leading)
        } else {
            HStack(spacing: 6) {
                if desktop, let weight = presentation.priority.weight, weight > 0 {
                    Image(systemName: "exclamationmark").foregroundStyle(
                        FacetNativeStyle.tint(presentation.priority)
                    )
                    .help(presentation.priority.label).accessibilityHidden(true)
                }
                date
                metadataText
                markers
            }
        }
    }

    @ViewBuilder private var metadataText: some View {
        if !presentation.metadata.isEmpty {
            Text(presentation.metadata).foregroundStyle(FacetNativeStyle.secondaryText)
        }
    }

    private var checkbox: some View {
        Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
            .font(.system(size: desktop ? checkboxSize * 0.8 : checkboxSize))
            .foregroundStyle(
                desktop
                    ? FacetNativeStyle.secondaryText : FacetNativeStyle.tint(presentation.priority)
            )
            .animation(
                reducedMotion
                    ? nil
                    : .linear(
                        duration: FacetNativeStyle.tokens.motion.milliseconds.checkboxFill / 1000),
                value: task.completed)
    }

    private var date: some View {
        Group {
            if let dateLabel = presentation.date {
                Text(dateLabel).font(.caption).foregroundStyle(FacetNativeStyle.secondaryText)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
    }

    @ViewBuilder private var markers: some View {
        if presentation.recurring {
            Image(systemName: "repeat").foregroundStyle(FacetNativeStyle.secondaryText)
        }
        if presentation.pending {
            Image(systemName: "arrow.up.circle").foregroundStyle(FacetNativeStyle.secondaryText)
        }
        if presentation.blocked {
            Image(systemName: "lock").foregroundStyle(FacetNativeStyle.secondaryText)
        }
    }
}
