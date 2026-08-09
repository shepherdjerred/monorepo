internal import SwiftUI
internal import TaskNotesKit

/// The connection banner.
///
/// A strip, not an alert. A sync failure is the normal condition of an
/// offline-first app — the queue is durable, the work is not lost, and the user
/// usually needs to do nothing — so it is stated where it can be ignored rather
/// than raised where it must be dismissed. The plan is explicit about this:
/// `sync()` never throws, `status.lastError` carries the failure, and a banner
/// is what reads it.
struct SyncBannerView: View {
    let message: SyncMessage
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: message.systemImage)
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 1) {
                Text(message.title)
                    .font(.callout.weight(.medium))
                if let detail = message.detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            remedy
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        // A material rather than a colour: it tracks light and dark, sits
        // correctly against a vibrant window background, and dims with the
        // window when it is not the active one — all three of which a hex
        // literal gives up. The attention case washes the same material with
        // the tone's own hue at its faintest hierarchical step, which is a
        // semantic colour and follows appearance for free.
        .background(fill)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityIdentifier.SyncBanner.banner)
        .accessibilityLabel(
            [message.title, message.detail].compactMap(\.self).joined(separator: ". "))
    }

    /// The affordance the message actually warrants.
    ///
    /// The old banner offered **Try Again** on any message it could, which put
    /// the button on "3 changes waiting to sync" — a state where the engine is
    /// already draining the queue and pressing anything changes nothing. A
    /// banner that offers a remedy asserts a remedy is needed, so the
    /// informational case now offers none at all, and the two cases that cannot
    /// fix themselves point at the one place they can be fixed.
    @ViewBuilder
    private var remedy: some View {
        switch message.remedy {
        case .none:
            EmptyView()
        case .retry:
            Button("Try Again", action: onRetry)
                .accessibilityIdentifier(AccessibilityIdentifier.SyncBanner.retry)
        case .openSettings:
            // `SettingsLink` rather than a callback: it opens the app's own
            // `Settings` scene through the same path `⌘,` does, so there is one
            // way in and nothing to keep in sync.
            SettingsLink { Text("Open Settings…") }
                .accessibilityIdentifier(AccessibilityIdentifier.SyncBanner.openSettings)
        }
    }

    /// Semantic colour only, so it follows appearance and the accessibility
    /// colour filters without an in-app toggle to keep in sync.
    ///
    /// ⚠️ **Orange is spent once, on the tone that has earned it.** Offline and
    /// "no server configured" previously shared one orange warning triangle and
    /// so read as equally alarming — but one of them clears itself in a minute
    /// and the other never does. Only ``SyncMessage/Tone/attention`` — the tone
    /// that means *sync cannot work until you do something* — is coloured;
    /// degraded and informational are drawn in the hierarchical greys and are
    /// separated from each other by their glyph and by whether they offer an
    /// action at all.
    private var tint: AnyShapeStyle {
        switch message.tone {
        case .informational: AnyShapeStyle(.tertiary)
        case .degraded: AnyShapeStyle(.secondary)
        case .attention: AnyShapeStyle(.orange)
        }
    }

    /// The strip's own fill, which is the third channel severity moves in.
    private var fill: AnyShapeStyle {
        switch message.tone {
        case .informational, .degraded: AnyShapeStyle(.quaternary)
        case .attention: AnyShapeStyle(Color.orange.quaternary)
        }
    }
}
