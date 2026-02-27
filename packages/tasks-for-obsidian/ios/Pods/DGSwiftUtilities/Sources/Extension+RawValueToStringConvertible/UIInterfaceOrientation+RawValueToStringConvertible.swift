//
//  UIInterfaceOrientation+RawValueToStringConvertible.swift
//
//
//  Created by Dominic Go on 12/18/23.
//

import UIKit

extension UIInterfaceOrientation: RawValueToStringConvertible {

  // MARK: - CaseIterable
  // --------------------

  public static var allCases: [Self] = [
    .unknown,
    .portrait,
    .portraitUpsideDown,
    .landscapeLeft,
    .landscapeRight,
  ];

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
    switch self {
      case .unknown:
        return "unknown";

      case .portrait:
        return "portrait";

      case .portraitUpsideDown:
        return "portraitUpsideDown";

      case .landscapeLeft:
        return "landscapeLeft";

      case .landscapeRight:
        return "landscapeRight";

      @unknown default:
        #if DEBUG
        print("Runtime Warning - Not implemented -", #file);
        #endif

        return "";
    };
  };
};
