//
//  ComputableLayoutValueMode+EnumCaseStringRepresentable.swift
//  
//
//  Created by Dominic Go on 12/18/23.
//

import UIKit
import DGSwiftUtilities

extension ComputableLayoutValueMode:
  EnumCaseStringRepresentable, CustomStringConvertible {
  
  public var caseString: String {
    switch self {
      case .stretch:
        return "stretch";
        
      case .constant:
        return "constant";
        
      case .percent:
        return "percent";
        
      case .safeAreaInsets:
        return "safeAreaInsets";
        
      case .keyboardScreenRect:
        return "keyboardScreenRect";
        
      case .keyboardRelativeSize:
        return "keyboardRelativeSize";
        
      case .multipleValues:
        return "multipleValues";
        
      case .conditionalLayoutValue:
        return "conditionalLayoutValue";
        
      case .conditionalValue:
        return "conditionalValue";
        
    };
  };
};

