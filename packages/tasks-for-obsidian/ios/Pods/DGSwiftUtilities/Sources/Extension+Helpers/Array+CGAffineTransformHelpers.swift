//
//  Array+CGAffineTransformHelpers.swift
//  
//
//  Created by Dominic Go on 11/22/24.
//

import Foundation
import CoreGraphics


public extension Array where Element == CGAffineTransform {
  
  func concatenateTransforms() -> CGAffineTransform? {
    guard let firstTransform = self.first else {
      return nil;
    };
    
    let slice = self.dropFirst();
    
    return slice.reduce(firstTransform) {
      $0.concatenating($1);
    };
  };
};
