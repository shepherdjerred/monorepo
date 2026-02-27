//
//  PointPreset+StaticAlias.swift
//  
//
//  Created by Dominic Go on 6/21/24.
//

import Foundation

public extension PointPreset {
  static var top: Self {
    .topCenter
  };
  
  static var bottom: Self {
    .bottomCenter
  };
  
  static var left: Self {
    .centerLeft
  };
  
  static var right: Self {
    .centerRight
  };
};
