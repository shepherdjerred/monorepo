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
  @objc var tintColorHex: String = "" {
    didSet { applyTintColor() }
  }

  private func applyTintColor() {
    if !tintColorHex.isEmpty, let color = UIColor(hex: tintColorHex) {
      tintColor = color
    }
    updateImage()
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

private extension UIColor {
  convenience init?(hex: String) {
    var hexStr = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if hexStr.hasPrefix("#") { hexStr.removeFirst() }
    guard hexStr.count == 6 || hexStr.count == 8 else { return nil }
    var rgb: UInt64 = 0
    Scanner(string: hexStr).scanHexInt64(&rgb)
    if hexStr.count == 6 {
      self.init(
        red: CGFloat((rgb >> 16) & 0xFF) / 255,
        green: CGFloat((rgb >> 8) & 0xFF) / 255,
        blue: CGFloat(rgb & 0xFF) / 255,
        alpha: 1
      )
    } else {
      self.init(
        red: CGFloat((rgb >> 24) & 0xFF) / 255,
        green: CGFloat((rgb >> 16) & 0xFF) / 255,
        blue: CGFloat((rgb >> 8) & 0xFF) / 255,
        alpha: CGFloat(rgb & 0xFF) / 255
      )
    }
  }
}
