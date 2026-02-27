//
//  ComputableLayoutPreset+EnumCaseStringRepresentable.swift
//
//
//  Created by Dominic Go on 12/18/23.
//

import Foundation
import DGSwiftUtilities


extension ComputableLayoutPreset: EnumCaseStringRepresentable, CustomStringConvertible {
  public var caseString: String {
    switch self {
      case .automatic:
        return "automatic";
        
      case .offscreenBottom:
        return "offscreenBottom";
        
      case .offscreenTop:
        return "offscreenTop";
        
      case .offscreenLeft:
        return "offscreenLeft";
        
      case .offscreenRight:
        return "offscreenRight";
        
      case .halfOffscreenBottom:
        return "halfOffscreenBottom";
        
      case .halfOffscreenTop:
        return "halfOffscreenTop";
        
      case .halfOffscreenLeft:
        return "halfOffscreenLeft";
        
      case .halfOffscreenRight:
        return "halfOffscreenRight";
        
      case .edgeBottom:
        return "edgeBottom";
        
      case .edgeTop:
        return "edgeTop";
        
      case .edgeLeft:
        return "edgeLeft";
        
      case .edgeRight:
        return "edgeRight";
        
      case .fitScreen:
        return "fitScreen";
        
      case .fitScreenHorizontally:
        return "fitScreenHorizontally";
        
      case .fitScreenVertically:
        return "fitScreenVertically";
        
      case .center:
        return "center";
        
      case .layoutConfig(_):
        return "layoutConfig";
    };
  };
};
