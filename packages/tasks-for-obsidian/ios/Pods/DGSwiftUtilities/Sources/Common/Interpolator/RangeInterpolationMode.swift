//
//  RangeInterpolationMode.swift
//  
//
//  Created by Dominic Go on 7/20/24.
//

import Foundation


public enum RangeInterpolationMode {
  case extrapolateLeft;
  case extrapolateRight;
  case interpolate(interpolatorIndex: Int);
};
