import SwiftUI

/// Placeholder view shown when a service is unreachable.
struct ErrorStateView: View {
    let serviceName: String
    let errorMessage: String?

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "wifi.exclamationmark")
                .font(.largeTitle)
                .foregroundStyle(.secondary)

            Text("\(self.serviceName) Unreachable")
                .font(.headline)

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}
