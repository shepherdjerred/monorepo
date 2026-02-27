//
//  PointDirectionPreset+StaticAlias.swift
//  
//
//  Created by Dominic Go on 6/21/24.
//

import Foundation

public extension PointDirectionPreset {
  static var leftToRight: Self {
    .centerLeftToCenterRight;
  };
  
  static var rightToLeft: Self {
    .centerRightToCenterLeft;
  };
  
  static var topToBottom: Self {
    .centerTopToCenterBottom;
  };
  
  static var bottomToTop: Self {
    .centerBottomToCenterTop;
  };
};
