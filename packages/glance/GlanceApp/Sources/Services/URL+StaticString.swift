import Foundation

extension URL {
    /// Create a URL from a static string, crashing at runtime if the string is invalid.
    ///
    /// Use only for compile-time constant URL strings that are guaranteed to be valid.
    init(staticString: StaticString) {
        guard let url = URL(string: "\(staticString)") else {
            fatalError("Invalid static URL string: \(staticString)")
        }
        self = url
    }
}
