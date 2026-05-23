#if !SWIFT_PACKAGE
import Foundation

/// Shim for `Bundle.module` when building outside SPM (e.g. Xcode).
/// SPM auto-generates this accessor; Xcode needs it defined manually.
extension Bundle {
    static let module = Bundle.main
}
#endif
