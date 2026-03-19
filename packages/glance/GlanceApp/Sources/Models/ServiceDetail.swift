import Foundation

// MARK: - ServiceDetail

/// Rich detail data returned by each service provider.
enum ServiceDetail {
    case argoCD(applications: [ArgoCDApplication])
    case alertmanager(alerts: [AlertmanagerAlert])
    case prometheus(targets: [PrometheusTarget])
    case grafana(alertRules: [GrafanaAlertRule])
    case loki(entries: [LokiLogEntry])
    case bugsink(issues: [BugsinkIssue])
    case pagerDuty(incidents: [PagerDutyIncident], onCall: [PagerDutyOnCall])
    case github(pullRequests: [GitHubPullRequest])
    case buildkite(pipelines: [BuildkitePipeline])
    case kubernetes(pods: [KubernetesPod], nodes: [KubernetesNode])
    case talos(nodes: [TalosNode])
    case velero(backups: [VeleroBackup])
    case certManager(certificates: [CertManagerCertificate])
    case cloudflare(tunnels: [CloudflareTunnel])
    case empty
}

// MARK: - ArgoCDApplication

struct ArgoCDApplication: Codable, Identifiable {
    struct ArgoCDMetadata: Codable {
        let name: String
        let namespace: String
    }

    struct ArgoCDStatus: Codable {
        struct SyncStatus: Codable {
            let status: String
        }

        struct HealthStatus: Codable {
            let status: String
        }

        let sync: SyncStatus
        let health: HealthStatus
    }

    let metadata: ArgoCDMetadata
    let status: ArgoCDStatus

    var id: String {
        self.metadata.name
    }
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

// MARK: - PrometheusTarget

struct PrometheusTarget: Identifiable {
    let job: String
    let instance: String
    let health: String

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

// MARK: - LokiLogEntry

struct LokiLogEntry: Identifiable {
    let id: String
    let timestamp: String
    let message: String
    let labels: [String: String]
}

// MARK: - BugsinkIssue

struct BugsinkIssue: Codable, Identifiable {
    enum CodingKeys: String, CodingKey {
        case id
        case title
        case status
        case project
        case eventCount = "event_count"
    }

    let id: Int
    let title: String
    let status: String?
    let project: String?
    let eventCount: Int?
}

// MARK: - PagerDutyIncident

struct PagerDutyIncident: Codable, Identifiable {
    enum CodingKeys: String, CodingKey {
        case id
        case title
        case status
        case urgency
        case createdAt = "created_at"
    }

    let id: String
    let title: String
    let status: String
    let urgency: String
    let createdAt: String
}

// MARK: - PagerDutyOnCall

struct PagerDutyOnCall: Codable, Identifiable {
    enum CodingKeys: String, CodingKey {
        case user
        case escalationPolicy = "escalation_policy"
    }

    struct PagerDutyUser: Codable {
        let id: String
        let name: String
    }

    struct EscalationPolicy: Codable {
        let id: String
        let summary: String
    }

    let user: PagerDutyUser
    let escalationPolicy: EscalationPolicy

    var id: String {
        "\(self.user.id)-\(self.escalationPolicy.id)"
    }
}

// MARK: - GitHubPullRequest

struct GitHubPullRequest: Codable, Identifiable {
    enum CodingKeys: String, CodingKey {
        case id
        case number
        case title
        case state
        case draft
        case htmlUrl = "html_url"
        case user
        case createdAt = "created_at"
    }

    struct GitHubUser: Codable {
        let login: String
    }

    let id: Int
    let number: Int
    let title: String
    let state: String
    let draft: Bool
    let htmlUrl: String
    let user: GitHubUser
    let createdAt: String
}

// MARK: - BuildkitePipeline

struct BuildkitePipeline: Codable, Identifiable {
    enum CodingKeys: String, CodingKey {
        case id
        case name
        case slug
        case buildsUrl = "builds_url"
        case latestBuild
    }

    let id: String
    let name: String
    let slug: String
    let buildsUrl: String?
    let latestBuild: BuildkiteBuild?
}

// MARK: - BuildkiteBuild

struct BuildkiteBuild: Codable {
    enum CodingKeys: String, CodingKey {
        case id
        case number
        case state
        case message
        case createdAt = "created_at"
    }

    let id: String
    let number: Int
    let state: String
    let message: String?
    let createdAt: String?
}

// MARK: - KubernetesPod

struct KubernetesPod: Identifiable {
    let name: String
    let namespace: String
    let phase: String
    let ready: Bool
    let restarts: Int

    var id: String {
        "\(self.namespace)/\(self.name)"
    }
}

// MARK: - KubernetesNode

struct KubernetesNode: Identifiable {
    let name: String
    let ready: Bool
    let roles: [String]
    let version: String

    var id: String {
        self.name
    }
}

// MARK: - TalosNode

struct TalosNode: Identifiable {
    let hostname: String
    let ready: Bool
    let osVersion: String?

    var id: String {
        self.hostname
    }
}

// MARK: - VeleroBackup

struct VeleroBackup: Identifiable {
    let name: String
    let phase: String
    let completionTimestamp: String?
    let errors: Int
    let warnings: Int

    var id: String {
        self.name
    }
}

// MARK: - CertManagerCertificate

struct CertManagerCertificate: Identifiable {
    let name: String
    let namespace: String
    let ready: Bool
    let notAfter: String?
    let issuer: String

    var id: String {
        "\(self.namespace)/\(self.name)"
    }
}

// MARK: - CloudflareTunnel

struct CloudflareTunnel: Codable, Identifiable {
    enum CodingKeys: String, CodingKey {
        case id
        case name
        case status
        case createdAt = "created_at"
    }

    let id: String
    let name: String
    let status: String
    let createdAt: String?
}
