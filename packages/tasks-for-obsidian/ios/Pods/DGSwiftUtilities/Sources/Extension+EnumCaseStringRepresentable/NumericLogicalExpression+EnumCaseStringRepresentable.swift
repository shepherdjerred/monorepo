//
//  NumericLogicalExpression+EnumCaseStringRepresentable.swift
//  
//
//  Created by Dominic Go on 12/19/23.
//

import Foundation

extension NumericLogicalExpression: EnumCaseStringRepresentable {
  public var caseString: String {
    switch self {
      case .any:
        return "any";
        
      case .isLessThan:
        return "isLessThan";
        
      case .isLessThanOrEqual:
        return "isLessThanOrEqual";
        
      case .isEqual:
        return "isEqual";
        
      case .isGreaterThan:
        return "isGreaterThan";
        
      case .isGreaterThanOrEqual:
        return "isGreaterThanOrEqual";
        
      case .isBetweenRange:
        return "isBetweenRange";
    };
  };
};
