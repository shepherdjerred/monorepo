//
//  UIDeviceOrientation+RawValueToStringConvertible.swift
//
//
//  Created by Dominic Go on 12/17/23.
//

import UIKit

extension UIDeviceOrientation: RawValueToStringConvertible {

  // MARK: - CaseIterable
  // --------------------

  public static let allCases: [Self] = [
    .unknown,
    .portrait,
    .portraitUpsideDown,
    .landscapeLeft,
    .landscapeRight,
    .faceUp,
    .faceDown,
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

      case .faceUp:
        return "faceUp";

      case .faceDown:
        return "faceDown";

      @unknown default:
        #if DEBUG
        print("Runtime Warning - Not implemented -", #file);
        #endif

        return Self.unknown.caseString;
    }
  };
};
