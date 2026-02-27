//
//  AnyRangeInterpolatorStateTracking.swift
//  
//
//  Created by Dominic Go on 7/21/24.
//

import Foundation


public protocol AnyRangeInterpolatorStateTracking: AnyRangeInterpolating {
  
  var inputValuePrev: CGFloat? { get set };
  var inputValueCurrent: CGFloat? { get set };
  
  var interpolationModePrevious: RangeInterpolationMode? { get set };
  var interpolationModeCurrent: RangeInterpolationMode? { get set };
};

public extension AnyRangeInterpolatorStateTracking {
  
  var currentInputInterpolator: Self.InputInterpolator? {
    guard let interpolationModeCurrent = self.interpolationModeCurrent else {
      return nil;
    };
    
    switch interpolationModeCurrent {
      case .extrapolateLeft:
        return self.inputExtrapolatorLeft;
        
      case .extrapolateRight:
        return self.inputExtrapolatorRight;
        
      case let .interpolate(interpolatorIndex):
        return self.inputInterpolators[interpolatorIndex];
    };
  };
  
  var currentInterpolationIndex: Int? {
    guard let interpolationModeCurrent = self.interpolationModeCurrent else {
      return nil;
    };
    
    switch interpolationModeCurrent {
      case .extrapolateLeft:
        return 0;
        
      case .extrapolateRight:
        return self.rangeInput.count - 1;
        
      case let .interpolate(interpolatorIndex):
        return interpolatorIndex;
    };
  };
};
