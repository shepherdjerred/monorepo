//
//  HorizontalPointPreset.swift
//  
//
//  Created by Dominic Go on 6/21/24.
//

import Foundation


public enum HorizontalPointPreset: String {
  case left, center, right;
  
  public var value: CGFloat {
    switch self {
      case .left:
        return 0;
        
      case .center:
        return 0.5;
        
      case .right:
        return 1;
    };
  };
};
