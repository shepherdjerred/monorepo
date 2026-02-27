//
//  RangeInterpolatorStateTracking.swift
//  
//
//  Created by Dominic Go on 7/20/24.
//

import Foundation



public protocol RangeInterpolatorStateTracking: AnyRangeInterpolatorStateTracking, RangeInterpolating {
  
  var outputValuePrev: InterpolatableValue? { get set };
  var outputValueCurrent: InterpolatableValue? { get set };
};

public extension RangeInterpolatorStateTracking {
  
  var currentOutputInterpolator: Self.OutputInterpolator? {
    guard let interpolationModeCurrent = self.interpolationModeCurrent else {
      return nil;
    };
    
    switch interpolationModeCurrent {
      case .extrapolateLeft:
        return self.outputExtrapolatorLeft;
        
      case .extrapolateRight:
        return self.outputExtrapolatorRight;
        
      case let .interpolate(interpolatorIndex):
        return self.outputInterpolators[interpolatorIndex];
    };
  };
  
  mutating func interpolate(
    inputValue: CGFloat,
    shouldUpdateState: Bool = true
  ) -> InterpolatableValue {
  
    let (result, nextInterpolationMode) = self.compute(
      usingInputValue: inputValue,
      currentInterpolationIndex: self.currentInterpolationIndex
    );
    
    if shouldUpdateState {
      self.inputValuePrev = self.inputValueCurrent;
      self.inputValueCurrent = inputValue;
      
      self.outputValuePrev = self.outputValueCurrent;
      self.outputValueCurrent = result;
      
      self.interpolationModePrevious = self.interpolationModeCurrent;
      self.interpolationModeCurrent = nextInterpolationMode;
    };
    
    return result;
  };
  
  mutating func interpolate(
    inputPercent: CGFloat,
    shouldUpdateState: Bool = true
  ) -> InterpolatableValue {
  
    let inputValue = self.interpolateRangeInput(inputPercent: inputPercent);
    
    return self.interpolate(
      inputValue: inputValue,
      shouldUpdateState: shouldUpdateState
    );
  };
};
