//
//  ComputableLayoutValueEvaluableCondition+EnumCaseStringRepresentable.swift
//
//
//  Created by Dominic Go on 12/18/23.
//

import UIKit
import DGSwiftUtilities

extension ComputableLayoutValueEvaluableCondition:
  EnumCaseStringRepresentable, CustomStringConvertible {
  
  public var caseString: String {
    switch self {
      case .isNilOrZero(_):
        return "isNilOrZero";
        
      case .keyboardPresent:
        return "keyboardPresent";
    };
  };
};
