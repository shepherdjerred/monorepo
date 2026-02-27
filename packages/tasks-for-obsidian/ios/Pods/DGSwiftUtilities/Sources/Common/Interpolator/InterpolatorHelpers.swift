//
//  InterpolatorHelpers.swift
//  
//
//  Created by Dominic Go on 7/16/24.
//

import Foundation
import UIKit


public struct InterpolatorHelpers {

  // MARK: - Lerp-Related
  // --------------------
  
  public static func lerp<T: BinaryFloatingPoint>(
    valueStart: T,
    valueEnd: T,
    percent: T
  ) -> T {
  
    let deltaRange = valueEnd - valueStart;
    let totalChange = deltaRange * percent;
    
    let interpolatedValue = valueStart + totalChange;
    return interpolatedValue;
  };
  
  /// solve for `percent`, given: `valueStart`, `valueEnd`, `interpolatedValue`
  ///
  /// lerp formula, solve for `p`
  /// `iv = vs + p * (vs - ve)
  /// `iv - vs = p * (vs - ve)`
  /// `(iv - vs) / (vs - ve) = p`
  ///
  public static func inverseLerp<T: BinaryFloatingPoint>(
    valueStart: T,
    valueEnd: T,
    interpolatedValue: T
  ) -> T {

    let deltaChange = interpolatedValue - valueStart;
    let deltaRange = valueEnd - valueStart;
    
    let changePercent = deltaChange / deltaRange;
    return changePercent;
  };

  public static func lerp<T: BinaryFloatingPoint>(
    valueStart: T,
    valueEnd: T,
    percent: T,
    easingFunction: (T) -> T
  ) -> T {
  
    let percentWithEasing = easingFunction(percent);
    return lerp(
      valueStart: valueStart,
      valueEnd: valueEnd,
      percent: percentWithEasing
    );
  };
  
  public static func lerp(
    valueStart: CGFloat,
    valueEnd: CGFloat,
    percent: CGFloat,
    easing: InterpolationEasing?
  ) -> CGFloat {
  
    let percentWithEasing = easing?.compute(percentValue: percent) ?? percent;
    return lerp(
      valueStart: valueStart,
      valueEnd: valueEnd,
      percent: percentWithEasing
    );
  };
  
  public static func lerp<
    T: UniformInterpolatable,
    U: UniformInterpolatable
  >(
    valueStartType: T.Type = T.self,
    valueEndType: U.Type = U.self,
    valueStart: T.InterpolatableValue,
    valueEnd: U.InterpolatableValue,
    percent: CGFloat,
    easing: InterpolationEasing
  ) -> T.InterpolatableValue? {
  
    guard let valueEnd = valueEnd as? T.InterpolatableValue else {
      return nil
    };
    
    return T.lerp(
      valueStart: valueStart,
      valueEnd: valueEnd,
      percent: percent,
      easing: easing
    );
  };
  
  // MARK: - "Ranged Lerp"-Related
  // -----------------------------
  
  public static func rangedLerp<
    T: UniformInterpolatable,
    U: UniformInterpolatable
  >(
    valueType: T.Type = T.self,
    returnType: U.Type = U.self,
    keyPath: PartialKeyPath<T.InterpolatableValue>,
    valueStart: T.InterpolatableValue,
    valueEnd: T.InterpolatableValue,
    percent: CGFloat,
    easing: InterpolationEasing?
  ) -> U.InterpolatableValue? {
  
    guard let keyPath = keyPath as? KeyPath<
      T.InterpolatableValue,
      U.InterpolatableValue
    > else {
      return nil;
    };
    
    let valueStart = valueStart[keyPath: keyPath];
    let valueEnd   = valueEnd  [keyPath: keyPath];
    
    return U.lerp(
      valueStart: valueStart,
      valueEnd: valueEnd,
      percent: percent,
      easing: easing
    );
  };
  
  public static func rangedLerp<
    T: UniformInterpolatable,
    U: UniformInterpolatable
  >(
    rootType: T.Type = T.self,
    valueType: U.Type = U.self,
    keyPath: PartialKeyPath<T>,
    valueStart: T,
    valueEnd: T,
    percent: CGFloat,
    easing: InterpolationEasing?,
    clampingOptions: ClampingOptions?,
    writeTo target: inout T
  ) -> Bool {
  
    guard let keyPath = keyPath as? WritableKeyPath<T, U.InterpolatableValue> else {
      return false;
    };
    
    let valueStart = valueStart[keyPath: keyPath];
    let valueEnd   = valueEnd  [keyPath: keyPath];
    
    let interpolatedValue = U.lerp(
      valueStart: valueStart,
      valueEnd: valueEnd,
      percent: percent,
      easing: easing,
      clampingOptions: clampingOptions ?? ClampingOptions.none
    );
    
    target[keyPath: keyPath] = interpolatedValue;
    return true;
  };
  
  public static func rangedLerp<
    T: UniformInterpolatable,
    U: CompositeInterpolatable
  >(
    rootType: T.Type = T.self,
    valueType: U.Type = U.self,
    keyPath: PartialKeyPath<T>,
    valueStart: T,
    valueEnd: T,
    percent: CGFloat,
    easingMap: U.EasingKeyPathMap,
    clampingMap: U.ClampingKeyPathMap,
    writeTo target: inout T
  ) -> Bool {
  
    guard let keyPath = keyPath as? WritableKeyPath<T, U.InterpolatableValue> else {
      return false;
    };
    
    let valueStart = valueStart[keyPath: keyPath];
    let valueEnd   = valueEnd  [keyPath: keyPath];
    
    let interpolatedValue = U.lerp(
      valueStart: valueStart,
      valueEnd: valueEnd,
      percent: percent,
      easingMap: easingMap,
      clampingMap: clampingMap
    );
    
    target[keyPath: keyPath] = interpolatedValue;
    return true;
  };
  
  public static func rangedLerp(
    inputValue: CGFloat,
    inputValueStart: CGFloat,
    inputValueEnd: CGFloat,
    outputValueStart: CGFloat,
    outputValueEnd: CGFloat,
    easing: InterpolationEasing = .linear
  ) -> CGFloat {

    let inputValueAdj   = inputValue    - inputValueStart;
    let inputRangeDelta = inputValueEnd - inputValueStart;

    let progressRaw = inputValueAdj / inputRangeDelta;
    let progress = progressRaw.isFinite ? progressRaw : 0;
          
    return Self.lerp(
      valueStart: outputValueStart,
      valueEnd  : outputValueEnd,
      percent   : progress
    );
  };
  
  public static func rangedLerp(
    relativePercent: CGFloat,
    inputValueStart: CGFloat,
    inputValueEnd: CGFloat,
    outputValueStart: CGFloat,
    outputValueEnd: CGFloat,
    easing: InterpolationEasing = .linear
  ) -> CGFloat {
    
    let rangeDelta = abs(inputValueStart - inputValueEnd);
    let inputValue = rangeDelta * relativePercent;
    
    let percentRaw = inputValue / rangeDelta;
    let percent = percentRaw.isFinite ? percentRaw : 0;
    
    return Self.lerp(
      valueStart: outputValueStart,
      valueEnd  : outputValueEnd,
      percent   : percent
    );
  };

  public static func rangedLerp(
    inputValue: CGFloat,
    rangeInput: [CGFloat],
    rangeOutput: [CGFloat],
    shouldClampMin: Bool = false,
    shouldClampMax: Bool = false,
    easing: InterpolationEasing = .linear
  ) -> CGFloat? {
  
    guard rangeInput.count == rangeOutput.count,
          rangeInput.count >= 2
    else { return nil };
    
    if shouldClampMin, inputValue < rangeInput.first! {
      return rangeOutput.first!;
    };
    
    if shouldClampMax, inputValue > rangeInput.last! {
      return rangeOutput.last!;
    };
    
    // A - Extrapolate Left
    if inputValue < rangeInput.first! {
      let rangeInputStart  = rangeInput.first!;
      let rangeInputEnd = rangeInput[1];
      
      let rangeOutputStart = rangeOutput.first!;
      let rangeOutputEnd = rangeOutput[1];
      
      return Self.rangedLerp(
        inputValue: inputValue,
        inputValueStart: rangeInputEnd,
        inputValueEnd: rangeInputStart,
        outputValueStart: rangeOutputEnd,
        outputValueEnd: rangeOutputStart,
        easing: easing
      );
    };
    
    let (rangeStartIndex, rangeEndIndex): (Int, Int) = {
      let rangeInputEnumerated = rangeInput.enumerated();
      
      let match = rangeInputEnumerated.first {
        guard let nextValue = rangeInput[safeIndex: $0.offset + 1]
        else { return false };
        
        return inputValue >= $0.element && inputValue < nextValue;
      };
      
      // B - Interpolate Between
      if let match = match {
        let rangeStartIndex = match.offset;
        return (rangeStartIndex, rangeStartIndex + 1);
      };
        
      let lastIndex         = rangeInput.count - 1;
      let secondToLastIndex = rangeInput.count - 2;
      
      // C - Extrapolate Right
      return (secondToLastIndex, lastIndex);
    }();
    
    guard let rangeInputStart  = rangeInput [safeIndex: rangeStartIndex],
          let rangeInputEnd    = rangeInput [safeIndex: rangeEndIndex  ],
          let rangeOutputStart = rangeOutput[safeIndex: rangeStartIndex],
          let rangeOutputEnd   = rangeOutput[safeIndex: rangeEndIndex  ]
    else { return nil };
    
    return Self.rangedLerp(
      inputValue      : inputValue,
      inputValueStart : rangeInputStart,
      inputValueEnd   : rangeInputEnd,
      outputValueStart: rangeOutputStart,
      outputValueEnd  : rangeOutputEnd,
      easing          : easing
    );
  };
  
  // MARK: - Misc
  // ------------
  
  public static func computeFinalPosition(
    position: CGFloat,
    initialVelocity: CGFloat,
    decelerationRate: CGFloat = UIScrollView.DecelerationRate.normal.rawValue
  ) -> CGFloat {
    let pointPerSecond = abs(initialVelocity) / 1000.0;
    let accelerationRate = 1 - decelerationRate;
    
    let displacement = (pointPerSecond * decelerationRate) / accelerationRate;
    
    return initialVelocity > 0
      ? position + displacement
      : position - displacement;
  };
  
  public static func invertPercent(_ percent: CGFloat) -> CGFloat {
    if percent >= 0 && percent <= 1 {
      return 1 - percent;
    };
    
    if percent < 0 {
      return abs(percent) + 1;
    };
    
    // percent > 1
    return -(percent - 1);
  };
};

// MARK: - Aliases/Alt
// -------------------

public extension InterpolatorHelpers {
  
  static func lerp<
    T: BinaryFloatingPoint,
    U: BinaryFloatingPoint
  >(
    valueStart: T,
    valueEnd: T,
    percent: U
  ) -> T {
  
    Self.lerp(
      valueStart: valueStart,
      valueEnd: valueEnd,
      percent: T(percent)
    );
  };
};
