import Foundation
import Testing

enum NativeTestFiles {
    static func remove(_ directory: URL) {
        do { try FileManager.default.removeItem(at: directory) } catch {
            Issue.record("Native test fixture cleanup failed: \(error)")
        }
    }
}
