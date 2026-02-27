//
//  UIContextMenuInteractionCommitStyle+RawValueToStringConvertible.swift
//
//
//  Created by Dominic Go on 12/18/23.
//

import UIKit

@available(iOS 13.0, *)
extension UIContextMenuInteractionCommitStyle: RawValueToStringConvertible {
  
  // MARK: - CaseIterable
  // --------------------
  
  public static var allCases: [Self] = [
    .dismiss,
    .pop,
  ];

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
    switch self {
      case .dismiss:
        return "dismiss";

      case .pop:
        return "pop";

      @unknown default:
        #if DEBUG
        print("Runtime Warning - Not implemented -", #file);
        #endif

        return "";
    };
  };
};
