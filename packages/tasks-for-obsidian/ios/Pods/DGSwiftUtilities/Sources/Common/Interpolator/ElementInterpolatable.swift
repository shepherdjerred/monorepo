//
//  ElementInterpolatable.swift
//  
//
//  Created by Dominic Go on 7/18/24.
//

import Foundation

/// `CompositeInterpolatable` but with individually "configurable" elements.
/// In other words, custom easing + clamping for each "interpolatable" property
/// (e.g. `size`, etc).
/// 
public protocol ElementInterpolatable: CompositeInterpolatable {
  
  associatedtype InterpolatableElements: CompositeInterpolatableElements;
  
  typealias EasingElementMap = [InterpolatableElements: InterpolationEasing];
  typealias ClampingElementMap = [InterpolatableElements: ClampingOptions];
};

public extension ElementInterpolatable {

  static func lerp(
    valueStart: Self.InterpolatableValue,
    valueEnd: Self.InterpolatableValue,
    percent: CGFloat,
    easingMap: EasingElementMap,
    clampingMap: ClampingElementMap
  ) -> Self.InterpolatableValue {
    
    var keyPathEasingMap: EasingKeyPathMap = [:];
    
    for (element, easing) in easingMap {
      let associatedPartialKeyPaths =
        element.getAssociatedPartialKeyPaths(forType: Self.self);
      
      associatedPartialKeyPaths.forEach {
        keyPathEasingMap[$0] = easing;
      };
    };
    
    var keyPathClampingMap: ClampingKeyPathMap = [:];
    
    for (element, clampingOptions) in clampingMap {
      let associatedPartialKeyPaths =
        element.getAssociatedPartialKeyPaths(forType: Self.self);
      
      associatedPartialKeyPaths.forEach {
        keyPathClampingMap[$0] = clampingOptions;
      };
    };
    
    return Self.lerp(
      valueStart: valueStart,
      valueEnd: valueEnd,
      percent: percent,
      easingMap: keyPathEasingMap,
      clampingMap: keyPathClampingMap
    );
  };
};
