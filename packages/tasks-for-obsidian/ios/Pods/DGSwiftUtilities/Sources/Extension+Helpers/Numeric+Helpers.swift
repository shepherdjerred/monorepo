//
//  Numeric+Helpers.swift
//  swift-programmatic-modal
//
//  Created by Dominic Go on 5/19/23.
//

import UIKit

public extension Numeric where Self: Comparable {
  func clamped(
    min lowerBound: Self? = nil,
    max upperBound: Self? = nil
  ) -> Self {

    var clampedValue = self;
    
    if let lowerBound = lowerBound {
      clampedValue = clampedValue < lowerBound
        ? lowerBound
        : clampedValue;
    };
    
    if let upperBound = upperBound {
      clampedValue = clampedValue > upperBound
        ? upperBound
        : clampedValue;
    };
    
    return clampedValue;
  };
  
  func clamped(minMax: Self) -> Self {
    self.clamped(min: 0 - minMax, max: minMax);
  };
};
