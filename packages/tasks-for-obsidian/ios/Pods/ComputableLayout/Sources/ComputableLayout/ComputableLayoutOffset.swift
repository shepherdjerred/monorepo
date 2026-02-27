//
//  ComputableLayoutComputableOffset.swift
//  adaptive-modal
//
//  Created by Dominic Go on 6/22/23.
//

import Foundation
import DGSwiftUtilities

public struct ComputableLayoutOffset {

  public var offset: Double;
  public var offsetOperation: NumericOperation;
  
  public func compute(
    withValue value: Double,
    isValueOnRHS: Bool = false
  ) -> Double {
    if isValueOnRHS {
      return self.offsetOperation.compute(a: value, b: self.offset);
    };
    
    return self.offsetOperation.compute(a: self.offset, b: value);
  };
};
