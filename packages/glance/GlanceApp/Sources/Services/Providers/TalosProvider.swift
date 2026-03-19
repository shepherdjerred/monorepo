import Foundation

// MARK: - TalosProvider

/// Monitors Talos Linux node health via talosctl.
struct TalosProvider: ServiceProvider {
    // MARK: Internal

    let id = "talos"
    let displayName = "Talos"
    let iconName = "cpu"
    let webURL: String? = nil

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let output = try await shellCommand("talosctl", arguments: ["get", "members", "-o", "json"])
            let nodes = self.parseMembers(from: output)

            let notReady = nodes.filter { !$0.ready }
            let status: ServiceStatus =
                if nodes.isEmpty {
                    .unknown
                } else if notReady.isEmpty {
                    .ok
                } else {
                    .error
                }

            let summary = "\(nodes.count) node\(nodes.count == 1 ? "" : "s"), \(notReady.count) not ready"

            return ServiceSnapshot(
                id: self.id,
                displayName: self.displayName,
                iconName: self.iconName,
                status: status,
                summary: summary,
                detail: .talos(nodes: nodes),
                error: nil,
                timestamp: .now,
            )
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    // MARK: Private

    /// Parse concatenated JSON objects from talosctl output.
    private func parseMembers(from data: Data) -> [TalosNode] {
        guard let text = String(data: data, encoding: .utf8) else {
            return []
        }

        var nodes: [TalosNode] = []
        var depth = 0
        var start: String.Index?

        for index in text.indices {
            let char = text[index]
            if char == "{" {
                if depth == 0 {
                    start = index
                }
                depth += 1
            } else if char == "}" {
                depth -= 1
                if depth == 0, let startIndex = start {
                    let jsonStr = String(text[startIndex ... index])
                    if let jsonData = jsonStr.data(using: .utf8),
                       let member = try? JSONDecoder().decode(TalosMemberResponse.self, from: jsonData)
                    {
                        nodes.append(TalosNode(
                            hostname: member.spec.hostname,
                            ready: !member.spec.machineType.isEmpty,
                            osVersion: member.spec.operatingSystem,
                        ))
                    }
                }
            }
        }

        return nodes
    }

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

// MARK: - TalosMemberResponse

private struct TalosMemberResponse: Codable {
    struct MemberSpec: Codable {
        let hostname: String
        let machineType: String
        let operatingSystem: String?
    }

    let spec: MemberSpec
}
