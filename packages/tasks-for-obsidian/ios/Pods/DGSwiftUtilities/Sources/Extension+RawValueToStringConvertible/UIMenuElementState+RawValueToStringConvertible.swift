//
//  UIMenuElementState+RawValueToStringConvertible.swift
//
//
//  Created by Dominic Go on 12/18/23.
//

import UIKit

@available(iOS 13.0, *)
extension UIMenuElement.State: RawValueToStringConvertible {

  // MARK: - CaseIterable
  // --------------------

  public static var allCases: [Self] = [
    .off,
    .on,
    .mixed,
  ];

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
    switch self {
      case .off:
        return "off";

      case .on:
        return "on";

      case .mixed:
        return "mixed";

      @unknown default:
        #if DEBUG
        print("Runtime Warning - Not implemented -", #file);
        #endif

        return "";
    };
  };
};
