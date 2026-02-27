//
//  UIViewAnimationCurve+RawValueToStringConvertible.swift
//  ReactNativeIosContextMenu
//
//  Created by Dominic Go on 11/22/23.
//

import UIKit

extension UIView.AnimationCurve: RawValueToStringConvertible {

  // MARK: - CaseIterable
  // --------------------

  public static var allCases: [Self] = [
    .easeInOut,
    .easeIn,
    .easeOut,
    .linear,
  ];

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
    switch self {
      case .easeInOut:
        return "easeInOut";

      case .easeIn:
        return "easeIn";

      case .easeOut:
        return "easeOut";

      case .linear:
        return "linear";

      default:
        return "unknown";
    };
  };
};
