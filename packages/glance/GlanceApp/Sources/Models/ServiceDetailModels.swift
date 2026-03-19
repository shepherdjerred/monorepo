import Foundation

// MARK: - LokiLogEntry

struct LokiLogEntry: Identifiable {
    let id: String
    let timestamp: String
    let message: String
    let labels: [String: String]
}

// MARK: - BugsinkIssue

struct BugsinkIssue: Codable, Identifiable, Hashable {
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

struct PagerDutyIncident: Codable, Identifiable, Hashable {
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

struct GitHubPullRequest: Codable, Identifiable, Hashable {
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

    struct GitHubUser: Codable, Hashable {
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

// MARK: - BuildkiteDetail

package struct BuildkiteDetail {
    // MARK: Lifecycle

    init(pipelines: [BuildkitePipeline] = [], recentBuilds: [BuildkiteRecentBuild] = []) {
        self.pipelines = pipelines
        self.recentBuilds = recentBuilds
    }

    // MARK: Internal

    let pipelines: [BuildkitePipeline]
    let recentBuilds: [BuildkiteRecentBuild]
}

// MARK: - BuildkiteRecentBuild

package struct BuildkiteRecentBuild: Identifiable, Hashable {
    // MARK: Package

    package let id: String

    // MARK: Internal

    let pipelineName: String
    let number: Int
    let state: String
    let message: String?
    let createdAt: String?
    let branch: String?
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

struct KubernetesPod: Identifiable, Hashable {
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

struct KubernetesNode: Identifiable, Hashable {
    let name: String
    let ready: Bool
    let roles: [String]
    let version: String

    var id: String {
        self.name
    }
}

// MARK: - KubernetesNodeMetric

struct KubernetesNodeMetric: Identifiable {
    let name: String
    let cpuMillicores: Int
    let memoryMB: Int

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

// MARK: - VeleroDetail

package struct VeleroDetail {
    // MARK: Lifecycle

    init(
        backups: [VeleroBackup] = [],
        schedules: [VeleroSchedule] = [],
        backupStorageLocations: [VeleroBackupStorageLocation] = [],
    ) {
        self.backups = backups
        self.schedules = schedules
        self.backupStorageLocations = backupStorageLocations
    }

    // MARK: Internal

    let backups: [VeleroBackup]
    let schedules: [VeleroSchedule]
    let backupStorageLocations: [VeleroBackupStorageLocation]
}

// MARK: - VeleroSchedule

package struct VeleroSchedule: Identifiable {
    // MARK: Package

    package var id: String {
        self.name
    }

    // MARK: Internal

    let name: String
    let schedule: String
    let lastBackup: String?
    let paused: Bool
}

// MARK: - VeleroBackupStorageLocation

package struct VeleroBackupStorageLocation: Identifiable {
    // MARK: Package

    package var id: String {
        self.name
    }

    // MARK: Internal

    let name: String
    let phase: String
    let lastValidationTime: String?
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

// MARK: - CertManagerDetail

package struct CertManagerDetail {
    // MARK: Lifecycle

    init(certificates: [CertManagerCertificate] = [], challenges: [CertManagerChallenge] = []) {
        self.certificates = certificates
        self.challenges = challenges
    }

    // MARK: Internal

    let certificates: [CertManagerCertificate]
    let challenges: [CertManagerChallenge]
}

// MARK: - CertManagerChallenge

package struct CertManagerChallenge: Identifiable {
    // MARK: Package

    package var id: String {
        "\(self.namespace)/\(self.name)"
    }

    // MARK: Internal

    let name: String
    let namespace: String
    let dnsName: String
    let state: String
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

// MARK: - AnthropicAPIUsage

struct AnthropicAPIUsage {
    let totalCost: Double
    let modelBreakdown: [AnthropicModelUsage]
    let billingPeriodStart: Date
    let billingPeriodEnd: Date
}

// MARK: - AnthropicModelUsage

struct AnthropicModelUsage: Identifiable {
    let model: String
    let inputTokens: Int
    let outputTokens: Int
    let cacheCreationTokens: Int
    let cacheReadTokens: Int

    var id: String {
        self.model
    }
}

// MARK: - OpenAIAPIUsage

struct OpenAIAPIUsage {
    let totalCost: Double
    let modelBreakdown: [OpenAIModelUsage]
    let billingPeriodStart: Date
    let billingPeriodEnd: Date
}

// MARK: - OpenAIModelUsage

struct OpenAIModelUsage: Identifiable {
    let model: String
    let inputTokens: Int
    let outputTokens: Int
    let requests: Int

    var id: String {
        self.model
    }
}
