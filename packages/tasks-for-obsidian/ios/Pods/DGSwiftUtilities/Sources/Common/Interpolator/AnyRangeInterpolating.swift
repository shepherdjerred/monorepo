//
//  AnyRangeInterpolating.swift
//  
//
//  Created by Dominic Go on 7/21/24.
//

import Foundation


public protocol AnyRangeInterpolating {

  typealias RangeItem = IndexValuePair<CGFloat>;
  typealias InputInterpolator = DGSwiftUtilities.Interpolator<CGFloat>;
  
  var rangeInput: [CGFloat] { get };
  
  var rangeInputMin: RangeItem { get };
  var rangeInputMax: RangeItem { get };
  
  var inputInterpolators: [InputInterpolator] { get };
  var inputExtrapolatorLeft: InputInterpolator { get };
  var inputExtrapolatorRight: InputInterpolator { get };
};

// MARK: - RangeInterpolating+Helpers
// ----------------------------------------

public extension AnyRangeInterpolating {
  
  func interpolateRangeInput(
    inputPercent: CGFloat,
    currentInterpolationIndex: Int? = nil
  ) -> CGFloat {
  
    let matchInterpolator = self.inputInterpolators.getInterpolator(
      forInputValue: inputPercent,
      withStartIndex: currentInterpolationIndex
    );
    
    if let (_, interpolator) = matchInterpolator {
      return interpolator.compute(usingInputValue: inputPercent);
    };
    
    // extrapolate left
    if inputPercent < self.rangeInput.first! {
      return self.inputExtrapolatorLeft.compute(usingInputValue: inputPercent);
    };
    
    // extrapolate right
    if inputPercent > self.rangeInput.last! {
      return self.inputExtrapolatorRight.compute(usingInputValue: inputPercent);
    };
    
    // this should never be called
    return InterpolatorHelpers.rangedLerp(
      inputValue: inputPercent,
      inputValueStart: self.inputInterpolators.first!.inputValueStart,
      inputValueEnd: self.inputInterpolators.last!.inputValueEnd,
      outputValueStart: self.rangeInput.first!,
      outputValueEnd: self.rangeInput.last!
    );
  };
};

// MARK: - RangeInterpolating+StaticHelpers
// ----------------------------------------

extension RangeInterpolating {
  
  static func createInputExtrapolatorLeft(
    rangeInput: [CGFloat],
    inputInterpolators: [InputInterpolator],
    clampingOptions: ClampingOptions
  ) -> InputInterpolator {
  
    let inputStart  = inputInterpolators[0].inputValueStart;
    let inputEnd    = inputInterpolators[0].inputValueEnd;
    let outputStart = rangeInput[1];
    let outputEnd   = rangeInput[0];
  
    return .init(
      inputValueStart: inputStart,
      inputValueEnd: inputEnd,
      outputValueStart: outputStart,
      outputValueEnd: outputEnd,
      clampingOptions: clampingOptions.shouldClampLeft ? .left : .none
    );
  }
  
  static func createInputExtrapolatorRight(
    rangeInput: [CGFloat],
    inputInterpolators: [InputInterpolator],
    clampingOptions: ClampingOptions
  ) -> InputInterpolator {
  
    let inputStart  = inputInterpolators.last!.inputValueStart;
    let inputEnd    = inputInterpolators.last!.inputValueEnd;
    let outputStart = rangeInput.secondToLast!;
    let outputEnd   = rangeInput.last!;
    
    return .init(
      inputValueStart: inputStart,
      inputValueEnd: inputEnd,
      outputValueStart: outputStart,
      outputValueEnd: outputEnd,
      easing: .linear,
      clampingOptions: clampingOptions.shouldClampRight ? .right : .none
    );
  };
};
