#if DEBUG

    import Foundation

    // MARK: - Sample Data

    /// Sample snapshots for SwiftUI previews.
    enum PreviewData {
        static let snapshots: [ServiceSnapshot] = [
            ServiceSnapshot(
                id: "kubernetes",
                displayName: "Kubernetes",
                iconName: "server.rack",
                status: .ok,
                summary: "12 pods healthy",
                detail: .empty,
                error: nil,
                timestamp: .now,
                webURL: nil,
            ),
            ServiceSnapshot(
                id: "argocd",
                displayName: "ArgoCD",
                iconName: "arrow.triangle.2.circlepath",
                status: .ok,
                summary: "8 apps synced",
                detail: .empty,
                error: nil,
                timestamp: .now,
                webURL: nil,
            ),
            ServiceSnapshot(
                id: "prometheus",
                displayName: "Prometheus",
                iconName: "flame",
                status: .warning,
                summary: "2 targets down",
                detail: .empty,
                error: nil,
                timestamp: .now,
                webURL: nil,
            ),
            ServiceSnapshot(
                id: "alertmanager",
                displayName: "Alertmanager",
                iconName: "bell.badge",
                status: .ok,
                summary: "1 active alert",
                detail: .empty,
                error: nil,
                timestamp: .now,
                webURL: nil,
            ),
            ServiceSnapshot(
                id: "grafana",
                displayName: "Grafana",
                iconName: "chart.bar.xaxis",
                status: .ok,
                summary: "All dashboards loaded",
                detail: .empty,
                error: nil,
                timestamp: .now,
                webURL: nil,
            ),
            ServiceSnapshot(
                id: "buildkite",
                displayName: "Buildkite",
                iconName: "hammer.fill",
                status: .error,
                summary: "3 builds failing",
                detail: .empty,
                error: "Pipeline timeout",
                timestamp: .now,
                webURL: nil,
            ),
            ServiceSnapshot(
                id: "github",
                displayName: "GitHub",
                iconName: "chevron.left.forwardslash.chevron.right",
                status: .ok,
                summary: "5 open PRs",
                detail: .empty,
                error: nil,
                timestamp: .now,
                webURL: nil,
            ),
            ServiceSnapshot(
                id: "anthropic-api",
                displayName: "Anthropic API",
                iconName: "brain.head.profile",
                status: .ok,
                summary: "$12.34 this month",
                detail: .empty,
                error: nil,
                timestamp: .now,
                webURL: nil,
            ),
            ServiceSnapshot(
                id: "talos",
                displayName: "Talos",
                iconName: "cpu",
                status: .ok,
                summary: "3 nodes healthy",
                detail: .empty,
                error: nil,
                timestamp: .now,
                webURL: nil,
            ),
            ServiceSnapshot(
                id: "cloudflare",
                displayName: "Cloudflare",
                iconName: "cloud.fill",
                status: .unknown,
                summary: "Checking...",
                detail: .empty,
                error: "Secret not loaded",
                timestamp: .now,
                webURL: nil,
            ),
        ]

        @MainActor
        static func makeSettings() -> GlanceSettings {
            GlanceSettings()
        }
    }

#endif
