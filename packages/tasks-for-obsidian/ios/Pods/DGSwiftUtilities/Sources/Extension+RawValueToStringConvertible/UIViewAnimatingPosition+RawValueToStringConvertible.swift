//
//  UIViewAnimatingPosition+RawValueToStringConvertible.swift
//  
//
//  Created by Dominic Go on 1/1/25.
//

import UIKit

extension UIViewAnimatingPosition: RawValueToStringConvertible {
  
  // MARK: - CaseIterable
  // --------------------
  
  public static var allCases: [UIViewAnimatingPosition] = [
    .start,
    .current,
    .end
  ];
  
  // MARK: - StringMappedRawRepresentable
  // ------------------------------------
  
  public var caseString: String {
    switch self {
      case .end:
        return "end";
        
      case .start:
        return "start";
        
      case .current:
        return "current";
        
      @unknown default:
        return "unknown";
    };
  };
};

