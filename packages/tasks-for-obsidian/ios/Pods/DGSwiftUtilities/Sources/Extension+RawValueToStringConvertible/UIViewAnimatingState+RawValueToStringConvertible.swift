//
//  UIViewAnimatingState+RawValueToStringConvertible.swift
//  react-native-ios-utilities
//
//  Created by Dominic Go on 12/31/24.
//

import UIKit

extension UIViewAnimatingState: RawValueToStringConvertible {

  // MARK: - CaseIterable
  // --------------------

  public static var allCases: [Self] = [
    .active,
    .inactive,
    .stopped,
  ];

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
    switch self {
      case .active:
        return "active";

      case .inactive:
        return "inactive";

      case .stopped:
        return "stopped";

      default:
        return "unknown";
    };
  };
};
