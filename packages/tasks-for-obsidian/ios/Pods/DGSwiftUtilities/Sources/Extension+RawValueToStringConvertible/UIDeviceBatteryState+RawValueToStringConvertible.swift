//
//  UIDeviceBatteryState+RawValueToStringConvertible.swift
//
//
//  Created by Dominic Go on 12/17/23.
//

import UIKit


extension UIDevice.BatteryState: RawValueToStringConvertible {
  
  // MARK: - CaseIterable
  // --------------------
  
  public static var allCases: [Self] = [
    .unknown,
    .unplugged,
    .charging,
    .full,
  ];
  
  // MARK: - StringMappedRawRepresentable
  // ------------------------------------
  
  public var caseString: String {
    switch self {
      case .unknown:
        return "unknown";
        
      case .unplugged:
        return "unplugged";
        
      case .charging:
        return "charging";
        
      case .full:
        return "full";
        
      @unknown default:
        #if DEBUG
        print("Runtime Warning - Not implemented -", #file);
        #endif
        
        return "unknown";
    };
  };
};
