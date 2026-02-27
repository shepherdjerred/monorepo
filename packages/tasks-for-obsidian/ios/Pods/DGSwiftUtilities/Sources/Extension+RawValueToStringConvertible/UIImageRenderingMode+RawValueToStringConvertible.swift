//
//  UIImageRenderingMode+RawValueToStringConvertible.swift
//
//
//  Created by Dominic Go on 1/1/25.
//

import UIKit

extension UIImage.RenderingMode: RawValueToStringConvertible {

  // MARK: - CaseIterable
  // --------------------

  public static var allCases: [Self] = [
    .automatic,
    .alwaysOriginal,
    .alwaysTemplate,
  ];

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
    switch self {
      case .automatic:
        return "automatic";

      case .alwaysOriginal:
        return "alwaysOriginal";

      case .alwaysTemplate:
        return "alwaysTemplate";

      default:
        return "unknown";
    };
  };
};
