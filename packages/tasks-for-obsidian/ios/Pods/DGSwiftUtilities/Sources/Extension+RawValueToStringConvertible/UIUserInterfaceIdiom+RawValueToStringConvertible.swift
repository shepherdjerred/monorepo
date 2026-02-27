//
//  UIUserInterfaceIdiom+RawValueToStringConvertible.swift
//  
//
//  Created by Dominic Go on 12/17/23.
//

import UIKit


extension UIUserInterfaceIdiom: RawValueToStringConvertible {

  // MARK: - CaseIterable
  // --------------------

  public static var allCases: [Self] {
    var cases: [Self] = [
      .unspecified,
    ];
    
    if #available(iOS 3.2, *) {
      cases.append(.phone);
      cases.append(.pad);
    };

    
    if #available(iOS 9.0, *) {
      cases.append(.tv);
      cases.append(.carPlay);
    };
    
    if #available(iOS 14.0, *) {
      cases.append(.mac);
    };
    
    return cases;
  };

  // MARK: - StringMappedRawRepresentable
  // ------------------------------------

  public var caseString: String {
    switch self {
      case .unspecified:
        return "unspecified";

      case .phone:
        return "phone";

      case .pad:
        return "pad";

      case .tv:
        return "tv";

      case .carPlay:
        return "carPlay";

      case .mac:
        return "mac";

      #if !targetEnvironment(macCatalyst)
      #if swift(>=5.9)
      case .vision:
        return "vision";
      #endif
      #endif

      @unknown default:
        #if DEBUG
        print("Runtime Warning - Not implemented -", #file);
        #endif

        return "";
    };
  };
};
