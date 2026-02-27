//
//  UIVibrancyEffectStyle+RawValueToStringConvertible.swift
//
//
//  Created by Dominic Go on 6/22/24.
//

import UIKit

@available(iOS 13.0, *)
extension UIVibrancyEffectStyle: RawValueToStringConvertible {

  public static var allCases: [UIVibrancyEffectStyle] {
    return [
      .label,
      .secondaryLabel,
      .tertiaryLabel,
      .quaternaryLabel,
      .fill,
      .secondaryFill,
      .tertiaryFill,
      .separator,
    ];
  };

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
    switch self {
      case .label:
        return "label";

      case .secondaryLabel:
        return "secondaryLabel";

      case .tertiaryLabel:
        return "tertiaryLabel";

      case .quaternaryLabel:
        return "quaternaryLabel";

      case .fill:
        return "fill";

      case .secondaryFill:
        return "secondaryFill";

      case .tertiaryFill:
        return "tertiaryFill";

      case .separator:
        return "separator";

      @unknown default:
        return "default";
    };
  }
};
