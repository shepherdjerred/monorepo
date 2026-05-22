import Foundation

// MARK: - VeleroProvider

/// Monitors Velero backup status via kubectl.
struct VeleroProvider: ServiceProvider {
    // MARK: Internal

    let id = "velero"
    let displayName = "Velero"
    let iconName = "externaldrive.fill.badge.checkmark"
    let webURL: String? = nil

    /// Parse Velero backups JSON into a ServiceSnapshot.
    static func parse(_ data: Data) throws -> ServiceSnapshot {
        let response = try JSONDecoder().decode(VeleroBackupList.self, from: data)

        let backups = response.items.suffix(20).reversed().map { item in
            VeleroBackup(
                name: item.metadata.name,
                phase: item.status?.phase ?? "Unknown",
                completionTimestamp: item.status?.completionTimestamp,
                errors: item.status?.errors ?? 0,
                warnings: item.status?.warnings ?? 0,
            )
        }

        let failed = backups.filter { $0.phase == "Failed" || $0.phase == "PartiallyFailed" }
        let status: ServiceStatus =
            if backups.isEmpty {
                .unknown
            } else if failed.isEmpty {
                .ok
            } else {
                .warning
            }

        let lastCompleted = backups.first { $0.phase == "Completed" }
        let summary =
            if let last = lastCompleted {
                "Last: \(last.completionTimestamp ?? "unknown"), \(failed.count) failed"
            } else {
                "\(backups.count) backup\(backups.count == 1 ? "" : "s")"
            }

        return ServiceSnapshot(
            id: "velero",
            displayName: "Velero",
            iconName: "externaldrive.fill.badge.checkmark",
            status: status,
            summary: summary,
            detail: .velero(detail: VeleroDetail(backups: Array(backups))),
            error: nil,
            timestamp: .now,
        )
    }

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let output = try await shellCommand("kubectl", arguments: [
                "get", "backups.velero.io", "-n", "velero",
                "-o", "json", "--sort-by=.metadata.creationTimestamp",
                "--request-timeout=8s",
            ])
            return try Self.parse(output)
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    func fetchDetail() async -> ServiceDetail {
        let log = GlanceLogger.provider(self.id)
        let start = ContinuousClock.now
        do {
            log.debug("Fetching deep Velero data")

            async let backupsData = shellCommand("kubectl", arguments: [
                "get", "backups.velero.io", "-n", "velero",
                "-o", "json", "--sort-by=.metadata.creationTimestamp",
                "--request-timeout=8s",
            ])
            async let bslData = shellCommand("kubectl", arguments: [
                "get", "backupstoragelocations.velero.io", "-n", "velero",
                "-o", "json", "--request-timeout=8s",
            ])
            async let schedulesData = shellCommand("kubectl", arguments: [
                "get", "schedules.velero.io", "-n", "velero",
                "-o", "json", "--request-timeout=8s",
            ])

            let backupsResponse = try await JSONDecoder().decode(VeleroBackupList.self, from: backupsData)
            let backups = backupsResponse.items.suffix(20).reversed().map { item in
                VeleroBackup(
                    name: item.metadata.name,
                    phase: item.status?.phase ?? "Unknown",
                    completionTimestamp: item.status?.completionTimestamp,
                    errors: item.status?.errors ?? 0,
                    warnings: item.status?.warnings ?? 0,
                )
            }

            let bslResponse = try await JSONDecoder().decode(VeleroBSLList.self, from: bslData)
            let bsls = bslResponse.items.map { item in
                VeleroBackupStorageLocation(
                    name: item.metadata.name,
                    phase: item.status?.phase ?? "Unknown",
                    lastValidationTime: item.status?.lastValidationTime,
                )
            }

            let schedulesResponse = try await JSONDecoder().decode(VeleroScheduleList.self, from: schedulesData)
            let schedules = schedulesResponse.items.map { item in
                VeleroSchedule(
                    name: item.metadata.name,
                    schedule: item.spec.schedule,
                    lastBackup: item.status?.lastBackup,
                    paused: item.spec.isPaused,
                )
            }

            let duration = ContinuousClock.now - start
            log.info("Deep fetch succeeded (\(duration, privacy: .public))")

            return .velero(detail: VeleroDetail(
                backups: Array(backups),
                schedules: schedules,
                backupStorageLocations: bsls,
            ))
        } catch {
            let duration = ContinuousClock.now - start
            log.error("Deep fetch failed (\(duration, privacy: .public)): \(error, privacy: .public)")
            return .empty
        }
    }

    // MARK: Private

    private func errorSnapshot(_ message: String) -> ServiceSnapshot {
        ServiceSnapshot(
            id: self.id,
            displayName: self.displayName,
            iconName: self.iconName,
            status: .unknown,
            summary: "Unreachable",
            detail: .empty,
            error: message,
            timestamp: .now,
        )
    }
}

// MARK: - VeleroBackupList

package struct VeleroBackupList: Codable {
    let items: [VeleroBackupItem]
}

// MARK: - VeleroBackupItem

package struct VeleroBackupItem: Codable {
    struct VeleroMetadata: Codable {
        let name: String
    }

    struct VeleroStatus: Codable {
        let phase: String?
        let completionTimestamp: String?
        let errors: Int?
        let warnings: Int?
    }

    let metadata: VeleroMetadata
    let status: VeleroStatus?
}

// MARK: - VeleroBSLList

package struct VeleroBSLList: Codable {
    let items: [VeleroBSLItem]
}

// MARK: - VeleroBSLItem

package struct VeleroBSLItem: Codable {
    struct Metadata: Codable {
        let name: String
    }

    struct Status: Codable {
        let phase: String?
        let lastValidationTime: String?
    }

    let metadata: Metadata
    let status: Status?
}

// MARK: - VeleroScheduleList

package struct VeleroScheduleList: Decodable {
    let items: [VeleroScheduleItem]
}

// MARK: - VeleroScheduleItem

package struct VeleroScheduleItem: Decodable {
    struct Metadata: Codable {
        let name: String
    }

    struct Spec: Decodable {
        // MARK: Lifecycle

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.schedule = try container.decode(String.self, forKey: .schedule)
            self.isPaused = (try? container.decode(Bool.self, forKey: .paused)) ?? false
        }

        // MARK: Internal

        let schedule: String
        let isPaused: Bool

        // MARK: Private

        private enum CodingKeys: String, CodingKey {
            case schedule
            case paused
        }
    }

    struct Status: Codable {
        let lastBackup: String?
    }

    let metadata: Metadata
    let spec: Spec
    let status: Status?
}
