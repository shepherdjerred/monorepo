import SwiftUI

/// Detail view showing Cert Manager certificate status.
struct CertManagerDetailView: View {
    let certificates: [CertManagerCertificate]

    var body: some View {
        if self.certificates.isEmpty {
            Text("No certificates found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.certificates) {
                TableColumn("Name") { cert in
                    Text(cert.name)
                        .fontWeight(.medium)
                }
                TableColumn("Namespace") { cert in
                    Text(cert.namespace)
                        .foregroundStyle(.secondary)
                }
                .width(120)
                TableColumn("Issuer") { cert in
                    Text(cert.issuer)
                        .foregroundStyle(.secondary)
                }
                .width(120)
                TableColumn("Expires") { cert in
                    Text(cert.notAfter ?? "-")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .width(160)
                TableColumn("Ready") { cert in
                    Circle()
                        .fill(cert.ready ? .green : .red)
                        .frame(width: 8, height: 8)
                }
                .width(50)
            }
            .frame(minHeight: 300)
        }
    }
}
