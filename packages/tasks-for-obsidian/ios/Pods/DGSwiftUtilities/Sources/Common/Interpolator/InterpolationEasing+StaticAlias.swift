//
//  InterpolationEasing+StaticAlias.swift
//  
//
//  Created by Dominic Go on 7/10/24.
//

import Foundation

public extension InterpolationEasing {
  
  static func easeInOutCustom(inputAmount: CGFloat) -> Self {
    .easeInOutCustom(easeInAmount: inputAmount, easeOutAmount: inputAmount);
  };
};
