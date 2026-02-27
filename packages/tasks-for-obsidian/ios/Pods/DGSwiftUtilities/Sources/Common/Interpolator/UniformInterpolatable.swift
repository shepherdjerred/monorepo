//
//  UniformInterpolatable.swift
//  
//
//  Created by Dominic Go on 7/16/24.
//

import Foundation


public protocol UniformInterpolatable: Comparable {

  associatedtype InterpolatableValue: UniformInterpolatable = Self;

  init();
  
  static func lerp(
    valueStart: InterpolatableValue,
    valueEnd: InterpolatableValue,
    percent: CGFloat,
    easing: InterpolationEasing?
  ) -> InterpolatableValue;
};

// MARK: - UniformInterpolatable+StaticHelpers
// -------------------------------------------

public extension UniformInterpolatable {

  typealias Interpolator = DGSwiftUtilities.Interpolator<Self>;

  typealias RangeInterpolator = DGSwiftUtilities.RangeInterpolator<Self>;
  
  static func lerp(
    valueStart: InterpolatableValue,
    valueEnd: InterpolatableValue,
    percent: CGFloat,
    easing: InterpolationEasing? = nil,
    clampingOptions: ClampingOptions = .none
  ) -> InterpolatableValue {
  
    let percentClamped = percent.clamped(
      min: clampingOptions.shouldClampLeft  ? 0 : nil,
      max: clampingOptions.shouldClampRight ? 1 : nil
    );
  
    return Self.lerp(
      valueStart: valueStart,
      valueEnd: valueEnd,
      percent: percentClamped,
      easing: easing
    );
  };
  
  static func rangedLerp(
    inputValue: CGFloat,
    inputValueStart: CGFloat,
    inputValueEnd: CGFloat,
    outputValueStart: InterpolatableValue,
    outputValueEnd: InterpolatableValue,
    easing: InterpolationEasing? = nil,
    clampingOptions: ClampingOptions = .none
  ) -> InterpolatableValue {
  
    let inputValueClamped = inputValue.clamped(
      min: clampingOptions.shouldClampLeft  ? inputValueStart : nil,
      max: clampingOptions.shouldClampRight ? inputValueEnd   : nil
    );

    let inputValueAdj   = inputValueClamped - inputValueStart;
    let inputRangeDelta = inputValueEnd     - inputValueStart;

    let progressRaw = inputValueAdj / inputRangeDelta;
    let progress = progressRaw.isFinite ? progressRaw : 0;
    
    return Self.lerp(
      valueStart: outputValueStart,
      valueEnd: outputValueEnd,
      percent: progress,
      easing: easing,
      clampingOptions: clampingOptions
    );
  };
  
  static func rangedLerp(
    relativePercent: CGFloat,
    inputValueStart: CGFloat,
    inputValueEnd: CGFloat,
    outputValueStart: InterpolatableValue,
    outputValueEnd: InterpolatableValue,
    easing: InterpolationEasing? = nil,
    clampingOptions: ClampingOptions = .none
  ) -> InterpolatableValue {
    
    let rangeDelta = abs(inputValueStart - inputValueEnd);
    let inputValue = rangeDelta * relativePercent;
    
    let inputValueClamped = inputValue.clamped(
      min: clampingOptions.shouldClampLeft  ? inputValueStart : nil,
      max: clampingOptions.shouldClampRight ? inputValueEnd   : nil
    );
    
    let percentRaw = inputValueClamped / rangeDelta;
    let percent = percentRaw.isFinite ? percentRaw : 0;
    
    return Self.lerp(
      valueStart: outputValueStart,
      valueEnd: outputValueEnd,
      percent: percent,
      easing: easing,
      clampingOptions: clampingOptions
    );
  };
};

// MARK: - UniformInterpolatable+BinaryFloatingPointHelpers
// --------------------------------------------------------

public extension UniformInterpolatable where InterpolatableValue: BinaryFloatingPoint {
    
  static func inverseLerp(
    valueStart: InterpolatableValue,
    valueEnd: InterpolatableValue,
    interpolatedValue: InterpolatableValue
  ) -> InterpolatableValue {
  
    InterpolatorHelpers.inverseLerp(
      valueStart: valueStart,
      valueEnd: valueEnd,
      interpolatedValue: interpolatedValue
    );
  };
};
