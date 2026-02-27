//
//  NumericLogicalExpression.swift
//  
//
//  Created by Dominic Go on 7/28/23.
//

import Foundation

public enum NumericLogicalExpression<T: Numeric & Comparable & Equatable>: Equatable {

  // MARK: Enum Values
  // -----------------
  
  case any;
  
  case isLessThan(toValue: T);
  case isLessThanOrEqual(toValue: T);
  
  case isEqual(toValue: T);
  
  case isGreaterThan(toValue: T);
  case isGreaterThanOrEqual(toValue: T);
  
  case isBetweenRange(
    start: T,
    end: T,
    isInclusive: Bool = true
  );
  
  // MARK: Functions
  // ---------------
  
  public func evaluate(forValue leftValue: T) -> Bool{
    switch self {
      case .any:
        return true;
        
      case let .isLessThan(rightValue):
        return leftValue < rightValue;
        
      case let .isLessThanOrEqual(rightValue):
        return leftValue <= rightValue;
        
      case let .isEqual(rightValue):
        return leftValue == rightValue;
        
      case let .isGreaterThan(rightValue):
        return leftValue > rightValue;
        
      case let .isGreaterThanOrEqual(rightValue):
        return leftValue >= rightValue;
        
      case let .isBetweenRange(start, end, isInclusive):
        return isInclusive
          ? leftValue >= start && leftValue <= end
          : leftValue >  start && leftValue <  end;
    };
  };
};
