//
//  InterpolationHelpers.swift
//  swift-programmatic-modal
//
//  Created by Dominic Go on 5/27/23.
//

import UIKit

@available(*, deprecated, renamed: "AdaptiveModalUtilities")
public typealias AdaptiveModalUtilities = InterpolationHelpers;


@available(*, deprecated, message: "Use InterpolatorHelpers or Interpolatable instead")
public class InterpolationHelpers {
  public static func lerp(
    valueStart: CGFloat,
    valueEnd: CGFloat,
    percent: CGFloat
  ) -> CGFloat {
    let valueDelta = valueEnd - valueStart;
    let valueProgress = valueDelta * percent
    return valueStart + valueProgress;
  };

  public static func extractValuesFromArray<T, U>(
    for array: [T],
    key: KeyPath<T, U>
  ) -> [U] {
    array.map {
      $0[keyPath: key];
    };
  };

  public static func interpolate(
    inputValue    : CGFloat,
    rangeInput    : [CGFloat],
    rangeOutput   : [CGFloat],
    shouldClampMin: Bool = false,
    shouldClampMax: Bool = false
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
      let rangeOutputStart = rangeOutput.first!;
       
      let delta1 = rangeInputStart - inputValue;
      let percent = delta1 / rangeInputStart;
      
      // extrapolated "range output end"
      let rangeOutputEnd = rangeOutputStart - (rangeOutput[1] - rangeOutputStart);
      
      let interpolatedValue = Self.lerp(
        valueStart: rangeOutputEnd,
        valueEnd  : rangeOutputStart,
        percent   : percent
      );
      
      let delta2 = interpolatedValue - rangeOutputEnd;
      return rangeOutputStart - delta2;
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
    
    let inputValueAdj    = inputValue    - rangeInputStart;
    let rangeInputEndAdj = rangeInputEnd - rangeInputStart;

    let progress = inputValueAdj / rangeInputEndAdj;
          
    return Self.lerp(
      valueStart: rangeOutputStart,
      valueEnd  : rangeOutputEnd,
      percent   : progress
    );
  };
  
  public static func interpolateColor(
    inputValue    : CGFloat,
    rangeInput    : [CGFloat],
    rangeOutput   : [UIColor],
    shouldClampMin: Bool = false,
    shouldClampMax: Bool = false
  ) -> UIColor? {
    var rangeR: [CGFloat] = [];
    var rangeG: [CGFloat] = [];
    var rangeB: [CGFloat] = [];
    var rangeA: [CGFloat] = [];
    
    for color in rangeOutput {
      let rgba = color.rgba;
      
      rangeR.append(rgba.r);
      rangeG.append(rgba.g);
      rangeB.append(rgba.b);
      rangeA.append(rgba.a);
    };
    
    let nextR = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: rangeR,
      shouldClampMin: shouldClampMin,
      shouldClampMax: shouldClampMax
    );
    
    let nextG = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: rangeG,
      shouldClampMin: shouldClampMin,
      shouldClampMax: shouldClampMax
    );
    
    let nextB = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: rangeB,
      shouldClampMin: shouldClampMin,
      shouldClampMax: shouldClampMax
    );
    
    let nextA = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: rangeA,
      shouldClampMin: shouldClampMin,
      shouldClampMax: shouldClampMax
    );
    
    guard let nextR = nextR,
          let nextG = nextG,
          let nextB = nextB,
          let nextA = nextA
    else { return nil };
    
    return UIColor(
      red  : nextR,
      green: nextG,
      blue : nextB,
      alpha: nextA
    );
  };
  
  public static func interpolateRect(
    inputValue : CGFloat,
    rangeInput : [CGFloat],
    rangeOutput: [CGRect],
    
    shouldClampMinHeight: Bool,
    shouldClampMaxHeight: Bool,
    shouldClampMinWidth : Bool,
    shouldClampMaxWidth : Bool,
    
    shouldClampMinX: Bool,
    shouldClampMaxX: Bool,
    shouldClampMinY: Bool,
    shouldClampMaxY: Bool
  ) -> CGRect? {
  
    let nextHeight = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.height
      ),
      shouldClampMin: shouldClampMinHeight,
      shouldClampMax: shouldClampMaxHeight
    );
    
    let nextWidth = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.width
      ),
      shouldClampMin: shouldClampMinWidth,
      shouldClampMax: shouldClampMaxWidth
    );
    
    let nextX = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.origin.x
      ),
      shouldClampMin: shouldClampMinX,
      shouldClampMax: shouldClampMaxX
    );
    
    let nextY = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.origin.y
      ),
      shouldClampMin: shouldClampMinY,
      shouldClampMax: shouldClampMaxY
    );
    
    guard let nextX = nextX,
          let nextY = nextY,
          let nextWidth  = nextWidth,
          let nextHeight = nextHeight
    else { return nil };
          
    return CGRect(
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight
    );
  };
  
  public static func interpolateTransform3D(
    inputValue : CGFloat,
    rangeInput : [CGFloat],
    rangeOutput: [Transform3D],
    
    shouldClampMinTranslateX: Bool,
    shouldClampMaxTranslateX: Bool,
    shouldClampMinTranslateY: Bool,
    shouldClampMaxTranslateY: Bool,
    shouldClampMinTranslateZ: Bool,
    shouldClampMaxTranslateZ: Bool,
    
    shouldClampMinScaleX: Bool,
    shouldClampMaxScaleX: Bool,
    shouldClampMinScaleY: Bool,
    shouldClampMaxScaleY: Bool,
    
    shouldClampMinRotationX: Bool,
    shouldClampMaxRotationX: Bool,
    shouldClampMinRotationY: Bool,
    shouldClampMaxRotationY: Bool,
    shouldClampMinRotationZ: Bool,
    shouldClampMaxRotationZ: Bool,
    
    shouldClampMinPerspective: Bool,
    shouldClampMaxPerspective: Bool,
    
    shouldClampMinSkewX: Bool,
    shouldClampMaxSkewX: Bool,
    shouldClampMinSkewY: Bool,
    shouldClampMaxSkewY: Bool
  ) -> Transform3D? {
  
    let nextTranslateX = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.translateX
      ),
      shouldClampMin: shouldClampMinTranslateX,
      shouldClampMax: shouldClampMaxTranslateX
    );
    
    let nextTranslateY = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.translateY
      ),
      shouldClampMin: shouldClampMinTranslateY,
      shouldClampMax: shouldClampMaxTranslateY
    );
    
    let nextTranslateZ = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.translateX
      ),
      shouldClampMin: shouldClampMinTranslateZ,
      shouldClampMax: shouldClampMaxTranslateZ
    );
    
    let nextScaleX = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.scaleX
      ),
      shouldClampMin: shouldClampMinScaleX,
      shouldClampMax: shouldClampMaxScaleX
    );
    
    let nextScaleY = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.scaleY
      ),
      shouldClampMin: shouldClampMinScaleY,
      shouldClampMax: shouldClampMaxScaleY
    );
    
    let nextRotationX = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.rotateX.radians
      ),
      shouldClampMin: shouldClampMinRotationX,
      shouldClampMax: shouldClampMaxRotationX
    );
    
    let nextRotationY = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.rotateY.radians
      ),
      shouldClampMin: shouldClampMinRotationY,
      shouldClampMax: shouldClampMaxRotationY
    );
    
    let nextRotationZ = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.rotateZ.radians
      ),
      shouldClampMin: shouldClampMinRotationZ,
      shouldClampMax: shouldClampMaxRotationZ
    );
    
    let nextPerspective = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.perspective
      ),
      shouldClampMin: shouldClampMinPerspective,
      shouldClampMax: shouldClampMaxPerspective
    );
    
    let nextSkewX = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.skewX
      ),
      shouldClampMin: shouldClampMinSkewX,
      shouldClampMax: shouldClampMaxSkewX
    );
    
    let nextSkewY = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.skewY
      ),
      shouldClampMin: shouldClampMinSkewY,
      shouldClampMax: shouldClampMaxSkewY
    );
    
    guard let nextTranslateX = nextTranslateX,
          let nextTranslateY = nextTranslateY,
          let nextTranslateZ = nextTranslateZ,
          let nextScaleX = nextScaleX,
          let nextScaleY = nextScaleY,
          let nextRotationX = nextRotationX,
          let nextRotationY = nextRotationY,
          let nextRotationZ = nextRotationZ,
          let nextPerspective = nextPerspective,
          let nextSkewX = nextSkewX,
          let nextSkewY = nextSkewY
    else { return nil };
    
    return Transform3D(
      translateX: nextTranslateX,
      translateY: nextTranslateY,
      translateZ: nextTranslateZ,
      scaleX: nextScaleX,
      scaleY: nextScaleY,
      rotateX: .radians(nextRotationX),
      rotateY: .radians(nextRotationY),
      rotateZ: .radians(nextRotationZ),
      perspective: nextPerspective,
      skewX: nextSkewX,
      skewY: nextSkewY
    );
  };
  
  public static func interpolateSize(
    inputValue    : CGFloat,
    rangeInput    : [CGFloat],
    rangeOutput   : [CGSize],
    shouldClampMin: Bool = false,
    shouldClampMax: Bool = false
  ) -> CGSize? {
  
    let nextWidth = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.width
      ),
      shouldClampMin: shouldClampMin,
      shouldClampMax: shouldClampMax
    );
    
    let nextHeight = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.height
      ),
      shouldClampMin: shouldClampMin,
      shouldClampMax: shouldClampMax
    );
    
    guard let nextWidth = nextWidth,
          let nextHeight = nextHeight
    else { return nil };

    return CGSize(
      width: nextWidth,
      height: nextHeight
    );
  };
  
  public static func interpolateEdgeInsets(
    inputValue    : CGFloat,
    rangeInput    : [CGFloat],
    rangeOutput   : [UIEdgeInsets],
    shouldClampMin: Bool = false,
    shouldClampMax: Bool = false
  ) -> UIEdgeInsets? {
  
    let insetTop = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.top
      ),
      shouldClampMin: shouldClampMin,
      shouldClampMax: shouldClampMax
    );
    
    let insetLeft = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.left
      ),
      shouldClampMin: shouldClampMin,
      shouldClampMax: shouldClampMax
    );
    
    let insetBottom = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.bottom
      ),
      shouldClampMin: shouldClampMin,
      shouldClampMax: shouldClampMax
    );
    
    let insetRight = Self.interpolate(
      inputValue: inputValue,
      rangeInput: rangeInput,
      rangeOutput: extractValuesFromArray(
        for: rangeOutput,
        key: \.right
      ),
      shouldClampMin: shouldClampMin,
      shouldClampMax: shouldClampMax
    );
    
    guard let insetTop = insetTop,
          let insetLeft = insetLeft,
          let insetBottom  = insetBottom,
          let insetRight = insetRight
    else { return nil };
          
    return UIEdgeInsets(
      top: insetTop,
      left: insetLeft,
      bottom: insetBottom,
      right: insetRight
    );
  };
  
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
