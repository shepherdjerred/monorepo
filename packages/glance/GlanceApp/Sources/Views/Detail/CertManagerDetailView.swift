import SwiftUI

/// Detail view showing Cert Manager certificate and challenge status.
struct CertManagerDetailView: View {
    // MARK: Internal

    let detail: CertManagerDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            self.certificatesSection
            if !self.detail.challenges.isEmpty {
                self.challengesSection
            }
        }
    }

    // MARK: Private

    @State private var certSortOrder = [KeyPathComparator(\CertManagerCertificate.name)]
    @State private var challengeSortOrder = [KeyPathComparator(\CertManagerChallenge.name)]

    private var sortedCertificates: [CertManagerCertificate] {
        self.detail.certificates.sorted(using: self.certSortOrder)
    }

    private var sortedChallenges: [CertManagerChallenge] {
        self.detail.challenges.sorted(using: self.challengeSortOrder)
    }

    // MARK: - Certificates

    @ViewBuilder
    private var certificatesSection: some View {
        Text("Certificates")
            .font(.headline)

        if self.detail.certificates.isEmpty {
            Text("No certificates found.")
                .foregroundStyle(.secondary)
        } else {
            self.certificatesTable
        }
    }

    private var certificatesTable: some View {
        Table(self.sortedCertificates, sortOrder: self.$certSortOrder) {
            TableColumn("Name", value: \.name) { cert in
                Text(cert.name)
                    .fontWeight(.medium)
            }
            TableColumn("Namespace", value: \.namespace) { cert in
                Text(cert.namespace)
                    .foregroundStyle(.secondary)
            }
            .width(120)
            TableColumn("Issuer", value: \.issuer) { cert in
                Text(cert.issuer)
                    .foregroundStyle(.secondary)
            }
            .width(120)
            TableColumn("Expires") { cert in
                self.expiryCountdown(cert.notAfter)
            }
            .width(160)
            TableColumn("Ready") { cert in
                Circle()
                    .fill(cert.ready ? .green : .red)
                    .frame(width: 8, height: 8)
            }
            .width(50)
        }
        .alternatingRowBackgrounds()
        .frame(minHeight: 200)
    }

    // MARK: - Challenges

    @ViewBuilder
    private var challengesSection: some View {
        Text("ACME Challenges")
            .font(.headline)

        Table(self.sortedChallenges, sortOrder: self.$challengeSortOrder) {
            TableColumn("Name", value: \.name) { challenge in
                Text(challenge.name)
                    .fontWeight(.medium)
                    .lineLimit(1)
            }
            TableColumn("Namespace", value: \.namespace) { challenge in
                Text(challenge.namespace)
                    .foregroundStyle(.secondary)
            }
            .width(120)
            TableColumn("DNS Name", value: \.dnsName) { challenge in
                Text(challenge.dnsName)
                    .font(.caption.monospaced())
            }
            .width(200)
            TableColumn("State", value: \.state) { challenge in
                self.challengeStateBadge(challenge.state)
            }
            .width(80)
        }
        .alternatingRowBackgrounds()
        .frame(minHeight: 100)
    }

    @ViewBuilder
    private func expiryCountdown(_ notAfter: String?) -> some View {
        if let notAfter, let expiryDate = Self.parseDate(notAfter) {
            TimelineView(.periodic(from: .now, by: 60)) { _ in
                let remaining = expiryDate.timeIntervalSinceNow
                let days = Int(remaining / 86400)
                if remaining <= 0 {
                    Text("Expired")
                        .font(.caption)
                        .foregroundStyle(.red)
                } else if days < 7 {
                    Text("\(days)d remaining")
                        .font(.caption)
                        .foregroundStyle(.orange)
                } else {
                    Text("\(days)d remaining")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        } else {
            Text(notAfter ?? "-")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func challengeStateBadge(_ state: String) -> some View {
        let color: Color =
            switch state {
            case "valid":
                .green
            case "pending":
                .orange
            case "invalid":
                .red
            default:
                .secondary
            }
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(state)
                .font(.caption)
        }
    }

    /// Parse an ISO 8601 date string from Kubernetes (e.g. "2025-06-15T12:00:00Z").
    private static func parseDate(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: string) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: string)
    }
}
