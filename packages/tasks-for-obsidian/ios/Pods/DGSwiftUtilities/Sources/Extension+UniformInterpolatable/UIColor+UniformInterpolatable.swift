//
//  UIColor+UniformInterpolatable.swift
//
//
//  Created by Dominic Go on 7/22/24.
//

import UIKit

extension UIColor: UniformInterpolatable {

  public typealias InterpolatableValue = UIColor;
  
  public static func lerp(
    valueStart colorStart: InterpolatableValue,
    valueEnd colorEnd: InterpolatableValue,
    percent: CGFloat,
    easing: InterpolationEasing?
  ) -> InterpolatableValue {
    
    var start_h: CGFloat = 0;
    var start_s: CGFloat = 0;
    var start_b: CGFloat = 0;
    var start_a: CGFloat = 0;
    
    colorStart.getHue(
      &start_h,
      saturation: &start_s,
      brightness: &start_b,
      alpha: &start_a
    );
    
    var end_h: CGFloat = 0;
    var end_s: CGFloat = 0;
    var end_b: CGFloat = 0;
    var end_a: CGFloat = 0;
    
    colorEnd.getHue(
      &end_h,
      saturation: &end_s,
      brightness: &end_b,
      alpha: &end_a
    );
    
    let result_h = InterpolatorHelpers.lerp(
      valueStart: start_h,
      valueEnd: end_h,
      percent: percent,
      easing: easing
    );
    
    let result_s = InterpolatorHelpers.lerp(
      valueStart: start_s,
      valueEnd: end_s,
      percent: percent,
      easing: easing
    );
    
    let result_b = InterpolatorHelpers.lerp(
      valueStart: start_b,
      valueEnd: end_b,
      percent: percent,
      easing: easing
    );
    
    let result_a = InterpolatorHelpers.lerp(
      valueStart: start_a,
      valueEnd: end_a,
      percent: percent,
      easing: easing
    );
    
    return .init(
      hue: result_s,
      saturation: result_h,
      brightness: result_b,
      alpha: result_a
    );
  };
};

