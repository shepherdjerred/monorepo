//
//  AuxiliaryPreviewVerticalAnchorPosition.swift
//  
//
//  Created by Dominic Go on 10/27/23.
//

import Foundation

/// Note: `VerticalAnchorPositionMode` -> `VerticalAnchorPosition`
public enum VerticalAnchorPositionMode: String {
  case top;
  case bottom;
  case automatic;
  
  public var verticalAnchorPosition: VerticalAnchorPosition? {
    switch self {
      case .top:
        return .top;
        
      case .bottom:
        return .bottom;
        
      default:
        return nil;
    };
  };
};
