//
//  CACornerMask+RawValueToStringConvertible.swift
//  
//
//  Created by Dominic Go on 1/1/25.
//

import UIKit


extension CACornerMask: RawValueToStringConvertible {
  
  // MARK: - CaseIterable
  // --------------------
  
  public static var allCases: [Self] = [
    .layerMinXMinYCorner,
    .layerMaxXMinYCorner,
    .layerMinXMaxYCorner,
    .layerMaxXMaxYCorner,
    .allCorners,
    .topCorners,
    .bottomCorners,
    .leftCorners,
    .rightCorners,
  ];
  
  // MARK: - StringMappedRawRepresentable
  // ------------------------------------
  
  public var caseString: String {
    switch self {
      case .layerMinXMinYCorner:
        return "layerMinXMinYCorner";
        
      case .layerMaxXMinYCorner:
        return "layerMaxXMinYCorner";
        
      case .layerMinXMaxYCorner:
        return "layerMinXMaxYCorner";
        
      case .layerMaxXMaxYCorner:
        return "layerMaxXMaxYCorner";
        
      case .allCorners:
        return "allCorners";
        
      case .topCorners:
        return "topCorners";
        
      case .bottomCorners:
        return "bottomCorners";
        
      case .leftCorners:
        return "leftCorners";
        
      case .rightCorners:
        return "rightCorners";

      default:
        return "unknown";
    };
  };
};

