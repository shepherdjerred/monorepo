//
//  ComputableLayoutValueEvaluableCondition.swift
//
//  Created by Dominic Go on 6/24/23.
//

import Foundation

public enum ComputableLayoutValueEvaluableCondition: Equatable {

  case isNilOrZero(_ value: ComputableLayoutValueMode);
  
  case keyboardPresent;
  
  public func evaluate(usingContext context: ComputableLayoutValueContext) -> Bool {
    switch self {
      case let .isNilOrZero(layoutValueMode):
        let layoutValue = layoutValueMode.compute(
          usingLayoutValueContext: context
        );
      
        return (layoutValue == nil || layoutValue == 0);
    
      case .keyboardPresent:
        return context.keyboardScreenRect != nil;
    };
  };
};
