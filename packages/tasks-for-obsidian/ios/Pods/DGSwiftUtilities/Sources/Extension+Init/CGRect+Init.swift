//
//  CGRect+Init.swift
//  Experiments-Misc
//
//  Created by Dominic Go on 11/13/24.
//

import Foundation


public extension CGRect {
  init(
    minX: CGFloat,
    minY: CGFloat,
    maxX: CGFloat,
    maxY: CGFloat
  ) {
    let origin: CGPoint = .init(x: minX, y: minY);
    
    let width = maxX - minX;
    let height = maxY - minY;
    
    self = .init(
      origin: origin,
      size: .init(width: width, height: height)
    );
  };
};
