//
//  Angle+UniformInterpolatable.swift
//
//
//  Created by Dominic Go on 7/24/24.
//

import Foundation


extension Angle: UniformInterpolatable {
  
  public static func lerp(
    valueStart: Self,
    valueEnd: Self,
    percent: CGFloat,
    easing: InterpolationEasing?
  ) -> Self {
  
    let (valueStart, valueEnd) = Self.normalizeToDegrees(valueStart, valueEnd);
    
    let resultRaw = InterpolatorHelpers.lerp(
      valueStart: .init(valueStart.rawValue),
      valueEnd: .init(valueEnd.rawValue),
      percent: percent,
      easing: easing
    );
    
    let result = T(resultRaw);
    return .degrees(result);
  };
  
  public init() {
    self = .zero;
  }
};


