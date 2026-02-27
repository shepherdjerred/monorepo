//
//  CGFloat+UniformInterpolatable.swift
//  
//
//  Created by Dominic Go on 7/16/24.
//

import Foundation


extension CGFloat: UniformInterpolatable {

  public typealias InterpolatableValue = Self;

  public static func lerp(
    valueStart: InterpolatableValue,
    valueEnd: InterpolatableValue,
    percent: CGFloat,
    easing: InterpolationEasing?
  ) -> InterpolatableValue {
    
    return InterpolatorHelpers.lerp(
      valueStart: valueStart,
      valueEnd: valueEnd,
      percent: percent,
      easing: easing
    );
  };
};



