/// Categorization of monitored services for sidebar grouping and filtering.
enum ServiceCategory: String, CaseIterable {
    case infrastructure = "Infrastructure"
    case cicd = "CI/CD"
    case observability = "Observability"
    case usage = "Usage"

    // MARK: Internal

    /// Human-readable display name for this category.
    var displayName: String {
        self.rawValue
    }

    /// Provider IDs belonging to this category.
    var providerIds: Set<String> {
        switch self {
        case .infrastructure:
            ["kubernetes", "talos", "certmanager", "velero", "cloudflare"]
        case .cicd:
            ["argocd", "buildkite", "github"]
        case .observability:
            ["prometheus", "alertmanager", "grafana", "loki", "bugsink", "pagerduty"]
        case .usage:
            ["anthropic-api", "openai-api", "claude-code", "codex"]
        }
    }

    /// Look up the category for a given provider ID.
    static func category(for providerId: String) -> Self? {
        allCases.first { $0.providerIds.contains(providerId) }
    }
}
