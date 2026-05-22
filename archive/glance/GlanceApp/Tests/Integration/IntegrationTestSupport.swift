import Foundation
import Testing

extension Tag {
    @Tag static var integration: Self
}

/// Whether integration tests are enabled via the `GLANCE_INTEGRATION` environment variable.
let integrationEnabled = ProcessInfo.processInfo.environment["GLANCE_INTEGRATION"] != nil
