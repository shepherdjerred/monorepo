import AppKit
import QuotaBarCore
import SwiftUI

struct BrimMenuBarLabel: View {
  let status: QuotaStatus

  var body: some View {
    Image(nsImage: BrimAssets.menuBarImage(for: status))
      .renderingMode(.template)
      .frame(width: 16, height: 16)
      .accessibilityLabel("Brim, \(status.accessibilityDescription)")
  }
}

struct BrimBrandMark: View {
  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 7)
        .fill(Color(red: 0.15, green: 0.15, blue: 0.36))
      Image(nsImage: BrimAssets.markImage)
        .resizable()
        .scaledToFit()
        .padding(4)
    }
    .frame(width: 24, height: 24)
    .accessibilityHidden(true)
  }
}

private enum BrimAssets {
  @MainActor
  static func menuBarImage(for status: QuotaStatus) -> NSImage {
    let image = loadImage(named: status.menuBarAssetName)
    image.size = NSSize(width: 16, height: 16)
    image.isTemplate = true
    return image
  }

  @MainActor
  static var markImage: NSImage { loadImage(named: "brim-mark-light") }

  @MainActor
  private static func loadImage(named name: String) -> NSImage {
    let bundle = PackagedResources.bundle
    guard let url = bundle.url(forResource: name, withExtension: "svg"),
      let image = NSImage(contentsOf: url)
    else {
      preconditionFailure("Missing Brim artwork resource: \(name).svg")
    }
    return image
  }
}

private extension QuotaStatus {
  var menuBarAssetName: String {
    switch self {
    case .healthy: "brim-menubar-full"
    case .warning: "brim-menubar-low"
    case .critical: "brim-menubar-critical"
    case .unavailable: "brim-menubar-unavailable"
    }
  }

  var accessibilityDescription: String {
    switch self {
    case .healthy: "healthy quota"
    case .warning: "low quota"
    case .critical: "critical quota"
    case .unavailable: "quota unavailable"
    }
  }
}
