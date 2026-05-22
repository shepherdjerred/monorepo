import Foundation

// MARK: - CertManagerProvider

/// Monitors Cert Manager certificate expiry via kubectl.
struct CertManagerProvider: ServiceProvider {
    // MARK: Internal

    let id = "certmanager"
    let displayName = "Cert Manager"
    let iconName = "lock.shield.fill"
    let webURL: String? = nil

    /// Parse kubectl certificates JSON into a ServiceSnapshot.
    static func parse(_ data: Data) throws -> ServiceSnapshot {
        let response = try JSONDecoder().decode(CertList.self, from: data)

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
            id: "certmanager",
            displayName: "Cert Manager",
            iconName: "lock.shield.fill",
            status: status,
            summary: summary,
            detail: .certManager(detail: CertManagerDetail(certificates: certificates)),
            error: nil,
            timestamp: .now,
        )
    }

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let output = try await shellCommand("kubectl", arguments: [
                "get", "certificates", "--all-namespaces", "-o", "json",
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
            log.debug("Fetching deep CertManager data")

            async let certsData = shellCommand("kubectl", arguments: [
                "get", "certificates", "--all-namespaces", "-o", "json",
                "--request-timeout=8s",
            ])
            async let challengesData = shellCommand("kubectl", arguments: [
                "get", "challenges.acme.cert-manager.io", "-A", "-o", "json",
                "--request-timeout=8s",
            ])

            let certResponse = try await JSONDecoder().decode(CertList.self, from: certsData)
            let certificates = certResponse.items.map { item in
                let ready = item.status?.conditions?.contains { $0.type == "Ready" && $0.status == "True" } ?? false
                return CertManagerCertificate(
                    name: item.metadata.name,
                    namespace: item.metadata.namespace,
                    ready: ready,
                    notAfter: item.status?.notAfter,
                    issuer: item.spec.issuerRef.name,
                )
            }

            let challenges: [CertManagerChallenge]
            do {
                let challengeResponse = try await JSONDecoder().decode(ChallengeList.self, from: challengesData)
                challenges = challengeResponse.items.map { item in
                    CertManagerChallenge(
                        name: item.metadata.name,
                        namespace: item.metadata.namespace,
                        dnsName: item.spec.dnsName,
                        state: item.status?.state ?? "unknown",
                    )
                }
            } catch {
                // Challenges CRD may not exist — that's fine
                challenges = []
            }

            let duration = ContinuousClock.now - start
            log.info("Deep fetch succeeded (\(duration, privacy: .public))")

            return .certManager(detail: CertManagerDetail(
                certificates: certificates,
                challenges: challenges,
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

// MARK: - CertList

package struct CertList: Codable {
    let items: [CertItem]
}

// MARK: - CertItem

package struct CertItem: Codable {
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

// MARK: - ChallengeList

package struct ChallengeList: Codable {
    let items: [ChallengeItem]
}

// MARK: - ChallengeItem

package struct ChallengeItem: Codable {
    struct Metadata: Codable {
        let name: String
        let namespace: String
    }

    struct Spec: Codable {
        let dnsName: String
    }

    struct Status: Codable {
        let state: String?
    }

    let metadata: Metadata
    let spec: Spec
    let status: Status?
}
