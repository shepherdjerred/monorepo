//
//  UIUserInterfaceSizeClass+RawValueToStringConvertible.swift
//
//
//  Created by Dominic Go on 12/17/23.
//

import UIKit

extension UIUserInterfaceSizeClass: RawValueToStringConvertible {

  // MARK: - CaseIterable
  // --------------------

  public static var allCases: [Self] = [
    .unspecified,
    .compact,
    .regular,
  ];

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
    switch self {
      case .unspecified:
        return "unspecified";

      case .compact:
        return "compact";

      case .regular:
        return "regular";

      @unknown default:
        #if DEBUG
        print("Runtime Warning - Not implemented -", #file);
        #endif

        return "";
    };
  };
};
