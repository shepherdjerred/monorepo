import Foundation

// MARK: - VeleroProvider

/// Monitors Velero backup status via kubectl.
struct VeleroProvider: ServiceProvider {
    // MARK: Internal

    let id = "velero"
    let displayName = "Velero"
    let iconName = "externaldrive.fill.badge.checkmark"
    let webURL: String? = nil

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let output = try await shellCommand("kubectl", arguments: [
                "get", "backups.velero.io", "-n", "velero",
                "-o", "json", "--sort-by=.metadata.creationTimestamp",
                "--request-timeout=8s",
            ])
            let response = try JSONDecoder().decode(VeleroBackupList.self, from: output)

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
                id: self.id,
                displayName: self.displayName,
                iconName: self.iconName,
                status: status,
                summary: summary,
                detail: .velero(backups: Array(backups)),
                error: nil,
                timestamp: .now,
            )
        } catch {
            return self.errorSnapshot(error.localizedDescription)
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

private struct VeleroBackupList: Codable {
    let items: [VeleroBackupItem]
}

// MARK: - VeleroBackupItem

private struct VeleroBackupItem: Codable {
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
