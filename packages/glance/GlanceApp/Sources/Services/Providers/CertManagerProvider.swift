import Foundation

// MARK: - CertManagerProvider

/// Monitors Cert Manager certificate expiry via kubectl.
struct CertManagerProvider: ServiceProvider {
    // MARK: Internal

    let id = "certmanager"
    let displayName = "Cert Manager"
    let iconName = "lock.shield.fill"
    let webURL: String? = nil

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let output = try await shellCommand("kubectl", arguments: [
                "get", "certificates", "--all-namespaces", "-o", "json",
                "--request-timeout=8s",
            ])
            let response = try JSONDecoder().decode(CertList.self, from: output)

            let certificates = response.items.map { item in
                let ready = item.status?.conditions?.contains { $0.type == "Ready" && $0.status == "True" } ?? false
                return CertManagerCertificate(
                    name: item.metadata.name,
                    namespace: item.metadata.namespace,
                    ready: ready,
                    notAfter: item.status?.notAfter,
                    issuer: item.spec.issuerRef.name,
                )
            }

            let notReady = certificates.filter { !$0.ready }
            let status: ServiceStatus =
                if certificates.isEmpty {
                    .unknown
                } else if notReady.isEmpty {
                    .ok
                } else {
                    .warning
                }

            let summary =
                notReady.isEmpty
                    ? "\(certificates.count) certificate\(certificates.count == 1 ? "" : "s") valid"
                    : "\(notReady.count) certificate\(notReady.count == 1 ? "" : "s") not ready"

            return ServiceSnapshot(
                id: self.id,
                displayName: self.displayName,
                iconName: self.iconName,
                status: status,
                summary: summary,
                detail: .certManager(certificates: certificates),
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

// MARK: - CertList

private struct CertList: Codable {
    let items: [CertItem]
}

// MARK: - CertItem

private struct CertItem: Codable {
    struct CertMetadata: Codable {
        let name: String
        let namespace: String
    }

    struct CertSpec: Codable {
        struct IssuerRef: Codable {
            let name: String
        }

        let issuerRef: IssuerRef
    }

    struct CertStatus: Codable {
        struct CertCondition: Codable {
            let type: String
            let status: String
        }

        let conditions: [CertCondition]?
        let notAfter: String?
    }

    let metadata: CertMetadata
    let spec: CertSpec
    let status: CertStatus?
}
