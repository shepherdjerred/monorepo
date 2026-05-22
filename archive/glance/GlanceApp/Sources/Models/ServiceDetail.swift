import Foundation

// MARK: - ServiceDetail

/// Rich detail data returned by each service provider.
enum ServiceDetail {
    case argoCD(detail: ArgoCDDetail)
    case alertmanager(detail: AlertmanagerDetail)
    case prometheus(detail: PrometheusDetail)
    case grafana(detail: GrafanaDetail)
    case loki(entries: [LokiLogEntry])
    case bugsink(issues: [BugsinkIssue])
    case pagerDuty(incidents: [PagerDutyIncident], onCall: [PagerDutyOnCall])
    case github(pullRequests: [GitHubPullRequest])
    case buildkite(detail: BuildkiteDetail)
    case kubernetes(detail: KubernetesDetail)
    case talos(nodes: [TalosNode])
    case velero(detail: VeleroDetail)
    case certManager(detail: CertManagerDetail)
    case cloudflare(tunnels: [CloudflareTunnel])
    case anthropicAPI(usage: AnthropicAPIUsage)
    case openAIAPI(usage: OpenAIAPIUsage)
    case claudeCode(usage: ClaudeCodeUsage)
    case codex(usage: CodexUsage)
    case empty
}

// MARK: - KubernetesDetail

package struct KubernetesDetail {
    // MARK: Lifecycle

    init(
        pods: [KubernetesPod] = [],
        nodes: [KubernetesNode] = [],
        events: [KubernetesEvent] = [],
        daemonSets: [KubernetesDaemonSet] = [],
        statefulSets: [KubernetesStatefulSet] = [],
        pvcs: [KubernetesPVC] = [],
        nodeMetrics: [KubernetesNodeMetric] = [],
    ) {
        self.pods = pods
        self.nodes = nodes
        self.events = events
        self.daemonSets = daemonSets
        self.statefulSets = statefulSets
        self.pvcs = pvcs
        self.nodeMetrics = nodeMetrics
    }

    // MARK: Internal

    let pods: [KubernetesPod]
    let nodes: [KubernetesNode]
    let events: [KubernetesEvent]
    let daemonSets: [KubernetesDaemonSet]
    let statefulSets: [KubernetesStatefulSet]
    let pvcs: [KubernetesPVC]
    let nodeMetrics: [KubernetesNodeMetric]
}

// MARK: - KubernetesEvent

package struct KubernetesEvent: Identifiable {
    // MARK: Package

    package var id: String {
        "\(self.namespace)/\(self.involvedObject)/\(self.reason)/\(self.lastTimestamp ?? "")"
    }

    // MARK: Internal

    let reason: String
    let message: String
    let involvedObject: String
    let namespace: String
    let type: String
    let count: Int
    let lastTimestamp: String?
}

// MARK: - KubernetesDaemonSet

package struct KubernetesDaemonSet: Identifiable {
    // MARK: Package

    package var id: String {
        "\(self.namespace)/\(self.name)"
    }

    // MARK: Internal

    let name: String
    let namespace: String
    let desiredScheduled: Int
    let ready: Int
}

// MARK: - KubernetesStatefulSet

package struct KubernetesStatefulSet: Identifiable {
    // MARK: Package

    package var id: String {
        "\(self.namespace)/\(self.name)"
    }

    // MARK: Internal

    let name: String
    let namespace: String
    let replicas: Int
    let readyReplicas: Int
}

// MARK: - KubernetesPVC

package struct KubernetesPVC: Identifiable {
    // MARK: Package

    package var id: String {
        "\(self.namespace)/\(self.name)"
    }

    // MARK: Internal

    let name: String
    let namespace: String
    let phase: String
    let capacity: String?
    let storageClass: String?
}

// MARK: - ArgoCDDetail

package struct ArgoCDDetail {
    // MARK: Lifecycle

    init(applications: [ArgoCDApplication] = [], revisionHistory: [ArgoCDRevisionEntry] = []) {
        self.applications = applications
        self.revisionHistory = revisionHistory
    }

    // MARK: Internal

    let applications: [ArgoCDApplication]
    let revisionHistory: [ArgoCDRevisionEntry]
}

// MARK: - ArgoCDRevisionEntry

package struct ArgoCDRevisionEntry: Identifiable {
    // MARK: Package

    package var id: String {
        "\(self.appName)/\(self.revision)/\(self.deployedAt ?? "")"
    }

    // MARK: Internal

    let appName: String
    let revision: String
    let deployedAt: String?
}

// MARK: - ArgoCDSyncStatus

struct ArgoCDSyncStatus: Codable, Hashable {
    let status: String
}

// MARK: - ArgoCDHealthStatus

struct ArgoCDHealthStatus: Codable, Hashable {
    let status: String
}

// MARK: - ArgoCDOperationState

struct ArgoCDOperationState: Codable, Hashable {
    let finishedAt: String?
    let syncResult: ArgoCDSyncResult?
}

// MARK: - ArgoCDSyncResult

struct ArgoCDSyncResult: Codable, Hashable {
    let revision: String?
}

// MARK: - ArgoCDApplication

struct ArgoCDApplication: Codable, Identifiable, Hashable {
    struct ArgoCDMetadata: Codable, Hashable {
        let name: String
        let namespace: String
    }

    struct ArgoCDStatus: Codable, Hashable {
        let sync: ArgoCDSyncStatus
        let health: ArgoCDHealthStatus
        let operationState: ArgoCDOperationState?
        let history: [ArgoCDHistoryEntry]?
    }

    struct ArgoCDHistoryEntry: Codable, Hashable {
        let revision: String?
        let deployedAt: String?
    }

    let metadata: ArgoCDMetadata
    let status: ArgoCDStatus

    var id: String {
        self.metadata.name
    }
}

// MARK: - PrometheusDetail

package struct PrometheusDetail {
    // MARK: Lifecycle

    init(targets: [PrometheusTarget] = [], alertRules: [PrometheusAlertRule] = []) {
        self.targets = targets
        self.alertRules = alertRules
    }

    // MARK: Internal

    let targets: [PrometheusTarget]
    let alertRules: [PrometheusAlertRule]
}

// MARK: - PrometheusAlertRule

package struct PrometheusAlertRule: Identifiable {
    // MARK: Package

    package var id: String {
        "\(self.group)/\(self.name)"
    }

    // MARK: Internal

    let name: String
    let state: String
    let group: String
    let severity: String?
}

// MARK: - AlertmanagerDetail

package struct AlertmanagerDetail {
    // MARK: Lifecycle

    init(alerts: [AlertmanagerAlert] = [], silences: [AlertmanagerSilence] = []) {
        self.alerts = alerts
        self.silences = silences
    }

    // MARK: Internal

    let alerts: [AlertmanagerAlert]
    let silences: [AlertmanagerSilence]
}

// MARK: - AlertmanagerSilence

package struct AlertmanagerSilence: Codable, Identifiable {
    // MARK: Package

    package let id: String

    // MARK: Internal

    struct SilenceStatus: Codable {
        let state: String
    }

    let createdBy: String
    let comment: String
    let startsAt: String
    let endsAt: String
    let status: SilenceStatus
}

// MARK: - AlertmanagerAlert

struct AlertmanagerAlert: Codable, Identifiable {
    struct AlertStatus: Codable {
        let state: String
    }

    let fingerprint: String
    let labels: [String: String]
    let annotations: [String: String]
    let status: AlertStatus
    let startsAt: String

    var id: String {
        self.fingerprint
    }
}

// MARK: - GrafanaDetail

package struct GrafanaDetail {
    // MARK: Lifecycle

    init(alertRules: [GrafanaAlertRule] = [], dashboards: [GrafanaDashboard] = []) {
        self.alertRules = alertRules
        self.dashboards = dashboards
    }

    // MARK: Internal

    let alertRules: [GrafanaAlertRule]
    let dashboards: [GrafanaDashboard]
}

// MARK: - GrafanaDashboard

package struct GrafanaDashboard: Codable, Identifiable {
    // MARK: Package

    package let id: Int

    // MARK: Internal

    let title: String
    let uri: String?
    let url: String?
}

// MARK: - PrometheusTarget

struct PrometheusTarget: Identifiable {
    // MARK: Lifecycle

    init(job: String, instance: String, health: String, lastScrapeDuration: Double? = nil) {
        self.job = job
        self.instance = instance
        self.health = health
        self.lastScrapeDuration = lastScrapeDuration
    }

    // MARK: Internal

    let job: String
    let instance: String
    let health: String
    let lastScrapeDuration: Double?

    var id: String {
        "\(self.job)-\(self.instance)"
    }
}

// MARK: - GrafanaAlertRule

struct GrafanaAlertRule: Codable, Identifiable {
    enum CodingKeys: String, CodingKey {
        case id
        case title
        case ruleGroup
    }

    var id: Int
    let title: String
    let ruleGroup: String?
}
