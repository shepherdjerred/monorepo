//
//  Array+BinaryFloatingPointHelpers.swift
//  
//
//  Created by Dominic Go on 11/17/24.
//

import Foundation

public extension Array where Element: BinaryFloatingPoint {
  
  var sumTotal: Element {
    self.reduce(into: 0) {
      $0 += $1;
    };
  };
  
  var average: Element {
    if self.count == 0 {
      return 0;
    };
    
    return self.sumTotal / Element(self.count);
  };
};
