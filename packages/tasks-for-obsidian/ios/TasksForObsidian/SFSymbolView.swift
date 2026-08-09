import UIKit
import React

@objc(SFSymbolViewManager)
class SFSymbolViewManager: RCTViewManager {
  override func view() -> UIView! {
    return SFSymbolImageView()
  }

  override static func requiresMainQueueSetup() -> Bool { return false }
}

class SFSymbolImageView: UIImageView {
  @objc var symbolName: String = "" {
    didSet { updateImage() }
  }
  @objc var symbolSize: CGFloat = 20 {
    didSet { updateImage() }
  }
  @objc var symbolWeight: String = "regular" {
    didSet { updateImage() }
  }

  private func updateImage() {
    let weight = mapWeight(symbolWeight)
    let config = UIImage.SymbolConfiguration(pointSize: symbolSize, weight: weight)
    if let img = UIImage(systemName: symbolName, withConfiguration: config) {
      image = img.withRenderingMode(.alwaysTemplate)
    }
    invalidateIntrinsicContentSize()
  }

  override var intrinsicContentSize: CGSize {
    CGSize(width: symbolSize, height: symbolSize)
  }

  private func mapWeight(_ value: String) -> UIImage.SymbolWeight {
    switch value {
    case "ultralight": return .ultraLight
    case "thin": return .thin
    case "light": return .light
    case "regular": return .regular
    case "medium": return .medium
    case "semibold": return .semibold
    case "bold": return .bold
    case "heavy": return .heavy
    case "black": return .black
    default: return .regular
    }
  }
}
