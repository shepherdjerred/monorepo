//
//  CompositeInterpolatable.swift
//  
//
//  Created by Dominic Go on 7/16/24.
//

import Foundation


public protocol CompositeInterpolatable: UniformInterpolatable {
  
  typealias InterpolatableValuesMap =
    [PartialKeyPath<InterpolatableValue>: any UniformInterpolatable.Type];
    
  typealias EasingKeyPathMap = [AnyKeyPath: InterpolationEasing];
  typealias ClampingKeyPathMap = [AnyKeyPath: ClampingOptions];

  static var interpolatablePropertiesMap: InterpolatableValuesMap { get };
  
  static func lerp(
    valueStart: InterpolatableValue,
    valueEnd: InterpolatableValue,
    percent: CGFloat,
    easingMap: EasingKeyPathMap,
    clampingMap: ClampingKeyPathMap
  ) -> InterpolatableValue;
};

// MARK: Default Conformance - `CompositeInterpolatable`
// ----------------------------------------------------

public extension CompositeInterpolatable {
  
  static func lerp(
    valueStart: InterpolatableValue,
    valueEnd: InterpolatableValue,
    percent: CGFloat,
    easingMap: EasingKeyPathMap,
    clampingMap: ClampingKeyPathMap
  ) -> InterpolatableValue {
    
    var newValue = valueStart;
    
    for (partialKeyPath, type) in Self.interpolatablePropertiesMap {
      let easing = easingMap[partialKeyPath];
      let clampingOptions = clampingMap[partialKeyPath];
      
      // recursive, not primitive value...
      // current property provides it's own interpolation function
      //
      if let type = type as? any CompositeInterpolatable.Type,
         InterpolatorHelpers.rangedLerp(
           rootType: InterpolatableValue.self,
           valueType: type,
           keyPath: partialKeyPath,
           valueStart: valueStart,
           valueEnd: valueEnd,
           percent: percent,
           easingMap: easingMap,
           clampingMap: clampingMap,
           writeTo: &newValue
         )
      {
        continue;
      };
      
      // not primitive value...
      // current property provides it's own interpolation function
      //
      if InterpolatorHelpers.rangedLerp(
        rootType: InterpolatableValue.self,
        valueType: type,
        keyPath: partialKeyPath,
        valueStart: valueStart,
        valueEnd: valueEnd,
        percent: percent,
        easing: easing,
        clampingOptions: clampingOptions,
        writeTo: &newValue
      ) {
        continue;
      };
    
      switch partialKeyPath {
        case let keyPath as WritableKeyPath<InterpolatableValue, CGFloat>:
          let concreteValueStart = valueStart[keyPath: keyPath];
          let concreteValueEnd   = valueEnd  [keyPath: keyPath];
          
          let result = InterpolatorHelpers.lerp(
            valueStart: concreteValueStart,
            valueEnd: concreteValueEnd,
            percent: percent,
            easing: easing
          );
          
          newValue[keyPath: keyPath] = result;
          continue;
          
        default:
          #if DEBUG
          let error = GenericError(
            errorCode: .runtimeError,
            description: "Case not implemented, unable to lerp"
          );
          fatalError(error.errorDescription!);
          #endif
          break;
      };
    };
    
    return newValue;
  };
};

// MARK: Default Conformance - `UniformInterpolatable`
// --------------------------------------------------

public extension CompositeInterpolatable {
  
  static func lerp(
    valueStart: InterpolatableValue,
    valueEnd: InterpolatableValue,
    percent: CGFloat,
    easing: InterpolationEasing? = nil
  ) -> InterpolatableValue {
    
    var easingMap: EasingKeyPathMap = [:];
    
    if let easing = easing {
      easingMap = Self.interpolatablePropertiesMap.reduce(into: [:]){
        $0[$1.key] = easing;
      };
    };
    
    return Self.lerp(
      valueStart: valueStart,
      valueEnd: valueEnd,
      percent: percent,
      easingMap: easingMap,
      clampingMap: [:] 
    );
  };
};

// MARK: - Functions - Helpers
// ---------------------------

public extension CompositeInterpolatable {
  
  static func rangedLerp(
    inputValue: CGFloat,
    inputValueStart: CGFloat,
    inputValueEnd: CGFloat,
    outputValueStart: InterpolatableValue,
    outputValueEnd: InterpolatableValue,
    easingMap: EasingKeyPathMap,
    clampingMap: ClampingKeyPathMap
  ) -> InterpolatableValue {
  
    let inputValueAdj   = inputValue    - inputValueStart;
    let inputRangeDelta = inputValueEnd - inputValueStart;

    let progressRaw = inputValueAdj / inputRangeDelta;
    let progress = progressRaw.isFinite ? progressRaw : 0;
    
    return Self.lerp(
      valueStart: outputValueStart,
      valueEnd: outputValueEnd,
      percent: progress,
      easingMap: easingMap,
      clampingMap: clampingMap
    );
  };
  
  static func rangedLerp(
    relativePercent: CGFloat,
    inputValueStart: CGFloat,
    inputValueEnd: CGFloat,
    outputValueStart: InterpolatableValue,
    outputValueEnd: InterpolatableValue,
    easingMap: EasingKeyPathMap,
    clampingMap: ClampingKeyPathMap
  ) -> InterpolatableValue {
    
    let rangeDelta = abs(inputValueStart - inputValueEnd);
    let inputValue = rangeDelta * relativePercent;
        
    let percentRaw = inputValue / rangeDelta;
    let percent = percentRaw.isFinite ? percentRaw : 0;
    
    return Self.lerp(
      valueStart: outputValueStart,
      valueEnd: outputValueEnd,
      percent: percent,
      easingMap: easingMap,
      clampingMap: clampingMap
    );
  };
};

// MARK: `CompositeInterpolatable+StaticHelpers`
// ---------------------------------------------

public extension CompositeInterpolatable {
  
  static func inverseLerp<T: BinaryFloatingPoint>(
    valueStart: InterpolatableValue,
    valueEnd: InterpolatableValue,
    interpolatedValue: InterpolatableValue
  ) -> T {
    
    let percentages: [T] = Self.interpolatablePropertiesMap.reduce(into: []) {
      switch $1.key {
        case let keyPath as WritableKeyPath<InterpolatableValue, T>:
          let concreteValueStart = valueStart[keyPath: keyPath];
          let concreteValueEnd = valueEnd[keyPath: keyPath];
          let concreteInterpolatedValue = interpolatedValue[keyPath: keyPath];
          
          let percent = InterpolatorHelpers.inverseLerp(
            valueStart: concreteValueStart,
            valueEnd: concreteValueEnd,
            interpolatedValue: concreteInterpolatedValue
          );
          
          $0.append(percent);
          
        default:
          #if DEBUG
          let error = GenericError(
            errorCode: .runtimeError,
            description: "Case not implemented, unable to lerp"
          );
          fatalError(error.errorDescription!);
          #endif
          break;
      };
    };
    
    let percentAvg = percentages.average;
    return percentAvg;
  };
};

// MARK: - Dictionary+CompositeInterpolatable.EasingKeyPathMap
// -----------------------------------------------------------

extension Dictionary where Self == CompositeInterpolatable.EasingKeyPathMap {

  init<T>(
    type: T.Type = T.self,
    easingElementMap: T.EasingElementMap
  ) where T: ElementInterpolatable {
  
    self = easingElementMap.reduce(into: [:]) {
      for keyPath in  $1.key.associatedAnyKeyPaths {
        $0[keyPath] = $1.value;
      };
    };
  };
};

// MARK: - Dictionary+CompositeInterpolatable.EasingKeyPathMap
// -----------------------------------------------------------

extension Dictionary where Self == CompositeInterpolatable.ClampingKeyPathMap {

  init<T>(
    type: T.Type = T.self,
    clampingElementMap: T.ClampingElementMap
  ) where T: ElementInterpolatable {
  
    self = clampingElementMap.reduce(into: [:]) {
      for keyPath in  $1.key.associatedAnyKeyPaths {
        $0[keyPath] = $1.value;
      };
    };
  };
};
