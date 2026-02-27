//
//  RangeInterpolatorGroup.swift
//  
//
//  Created by Dominic Go on 7/20/24.
//

import Foundation


public struct RangeInterpolatorGroup: AnyRangeInterpolating, AnyRangeInterpolatorStateTracking {
  
  public var rangeInput: [CGFloat];
  public var rangeInputMin: RangeItem;
  public var rangeInputMax: RangeItem;
  public var rangeInterpolatorTargetIndex: Int;
  
  public var inputInterpolators: [InputInterpolator];
  public var inputExtrapolatorLeft: InputInterpolator;
  public var inputExtrapolatorRight: InputInterpolator;
  
  public var inputValuePrev: CGFloat?;
  public var inputValueCurrent: CGFloat?;
  
  public var interpolationModePrevious: RangeInterpolationMode?
  public var interpolationModeCurrent: RangeInterpolationMode?
  
  public var rangeInterpolators: [any RangeInterpolating];
  
  
  public init(
    rangeInput: [CGFloat],
    rangeInterpolators: [any RangeInterpolating],
    rangeInterpolatorTargetIndex: Int = 0
  ) throws {
  
    guard rangeInterpolatorTargetIndex >= 0 else {
      throw GenericError(
        errorCode: .indexOutOfBounds,
        description: "rangeInterpolatorTargetIndex must not be less than 0"
      );
    };
  
    guard rangeInterpolatorTargetIndex < rangeInterpolators.count else {
      throw GenericError(
        errorCode: .indexOutOfBounds,
        description: "rangeInterpolatorTargetIndex must not exceed rangeInterpolators"
      );
    };
  
    let isRangeValuesConsistent = rangeInterpolators.allSatisfy {
         $0.rangeInput.count  == rangeInterpolators.count
      && $0.rangeOutput.count == rangeInterpolators.count;
    };
  
    guard isRangeValuesConsistent else {
      throw GenericError(
        errorCode: .invalidArgument,
        description: "count of rangeInput and items in rangeInterpolators are different"
      );
    };
    
    guard rangeInput.count >= 2 else {
      throw GenericError(
        errorCode: .invalidArgument,
        description: "rangeInput must have at least contain 2 items"
      );
    };
    
    let isTargetBlockSetForAll = rangeInterpolators.allSatisfy {
       $0.isTargetBlockSet;
    };
    
    guard isTargetBlockSetForAll else {
      throw GenericError(
        errorCode: .invalidArgument,
        description: "targetBlock must be set for all rangeInterpolators"
      );
    };
  
    self.rangeInput = rangeInput;
    self.rangeInterpolators = rangeInterpolators;
    self.rangeInterpolatorTargetIndex = rangeInterpolatorTargetIndex;
    
    self.rangeInputMin = rangeInput.indexedMin!;
    self.rangeInputMax = rangeInput.indexedMax!;
    
    let rangeInterpolatorTarget = rangeInterpolators[rangeInterpolatorTargetIndex];
    
    self.inputInterpolators     = rangeInterpolatorTarget.inputInterpolators;
    self.inputExtrapolatorLeft  = rangeInterpolatorTarget.inputExtrapolatorLeft;
    self.inputExtrapolatorRight = rangeInterpolatorTarget.inputExtrapolatorRight;
  };
  
  mutating func interpolateAndApplyToTarget(inputValue: CGFloat){
    let interpolationModePrev = self.interpolationModeCurrent;
    var interpolationModeNext: RangeInterpolationMode?;
    
    self.inputValuePrev = self.inputValueCurrent;
    self.inputValueCurrent = inputValue;
  
    for (index, rangeInterpolator) in rangeInterpolators.enumerated() {
    
      let interpolationMode = rangeInterpolator.computeAndApplyToTarget(
        usingInputValue: inputValue,
        currentInterpolationIndex: self.currentInterpolationIndex
      );
      
      if index == self.rangeInterpolatorTargetIndex {
        interpolationModeNext = interpolationMode;
      };
    };
    
    self.interpolationModePrevious = interpolationModePrev;
    self.interpolationModeCurrent = interpolationModeNext;
  };
  
  mutating func interpolateAndApplyToTarget(inputPercent: CGFloat){
    let inputValue = self.interpolateRangeInput(inputPercent: inputPercent);
    self.interpolateAndApplyToTarget(inputValue: inputValue);
  };
};
