//
//  UIImageSymbolWeight+RawValueToStringConvertible.swift
//
//
//  Created by Dominic Go on 8/9/24.
//

import UIKit


@available(iOS 13.0, *)
extension UIImage.SymbolWeight: RawValueToStringConvertible {

  // MARK: - CaseIterable
  // --------------------

  public static var allCases: [Self] = [
    .unspecified,
    .ultraLight,
    .thin,
    .light,
    .regular,
    .medium,
    .semibold,
    .bold,
    .heavy,
    .black,
  ];

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
    switch self {
      case .unspecified:
        return "unspecified";

      case .ultraLight:
        return "ultraLight";

      case .thin:
        return "thin";

      case .light:
        return "light";

      case .regular:
        return "regular";

      case .medium:
        return "medium";

      case .semibold:
        return "semibold";

      case .bold:
        return "bold";

      case .heavy:
        return "heavy";

      case .black:
        return "black";

      @unknown default:
        return "unknown";
    };
  };
};
