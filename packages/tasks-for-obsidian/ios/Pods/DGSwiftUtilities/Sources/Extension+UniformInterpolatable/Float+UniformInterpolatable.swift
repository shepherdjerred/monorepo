//
//  Float+UniformInterpolatable.swift
//
//
//  Created by Dominic Go on 10/8/24.
//

import Foundation


extension Float: UniformInterpolatable {

  public static func lerp(
    valueStart: Float,
    valueEnd: Float,
    percent: CGFloat,
    easing: InterpolationEasing?
  ) -> Float {
    
    let valueDelta = valueEnd - valueStart;
    let valueProgress = valueDelta * Float(percent);
    let result = valueStart + valueProgress;
    return result;
  };
};
