import Foundation

enum PackagedResources {
  nonisolated static let bundle: Bundle = {
    #if SWIFT_PACKAGE
      let bundleName = "QuotaBar_QuotaBar.bundle"
      if let resourceURL = Bundle.main.resourceURL,
        let bundle = Bundle(url: resourceURL.appendingPathComponent(bundleName))
      {
        return bundle
      }
      return Bundle.module
    #else
      return Bundle.main
    #endif
  }()
}
