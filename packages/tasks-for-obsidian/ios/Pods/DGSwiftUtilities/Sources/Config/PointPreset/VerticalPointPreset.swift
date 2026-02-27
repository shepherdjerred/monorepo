//
//  VerticalPointPreset.swift
//  
//
//  Created by Dominic Go on 6/21/24.
//

import Foundation

public enum VerticalPointPreset: String {
  case top, center, bottom;
  
  public var value: CGFloat {
    switch self {
      case .top:
        return 0;
        
      case .center:
        return 0.5;
        
      case .bottom:
        return 1;
    };
  };
};
