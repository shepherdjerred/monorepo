//
//  NumericOperation.swift
//
//
//  Created by Dominic Go on 12/19/23.
//

import Foundation

public enum NumericOperation: String, CaseIterable {
  case multiply, divide, add, subtract;
  
  public func compute(a: Double, b: Double) -> Double {
    switch self {
      case .add:
        return a + b;
        
      case .divide:
        return a / b;
        
      case .multiply:
        return a * b;
        
      case .subtract:
        return a - b;
    };
  };
};
