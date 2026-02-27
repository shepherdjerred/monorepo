//
//  UIUserInterfaceStyle+RawValueToStringConvertible.swift
//
//
//  Created by Dominic Go on 12/17/23.
//

import UIKit

extension UIUserInterfaceStyle: RawValueToStringConvertible {

  // MARK: - CaseIterable
  // --------------------

  public static let allCases: [Self] = [
    .unspecified,
    .light,
    .dark,
  ];

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
    switch self {
      case .unspecified:
        return "unspecified";

      case .light:
        return "light";

      case .dark:
        return "dark";

      @unknown default:
        #if DEBUG
        print("Runtime Warning - Not implemented -", #file);
        #endif

        return "";
    };
  };
};
