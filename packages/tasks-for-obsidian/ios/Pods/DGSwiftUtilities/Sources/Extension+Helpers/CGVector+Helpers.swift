//
//  CGVector+Helpers.swift
//
//
//  Created by Dominic Go on 11/21/24.
//

import Foundation

public extension CGVector {
  
  var vectorMagnitude: CGFloat {
    let xSquared = self.dx * self.dx;
    let ySquared = self.dy * self.dy;
    
    return sqrt(xSquared + ySquared);
  };
  
  /// convert to unit vector
  /// * converts the vector to have a length/magnitude of 1, while preserving
  ///   the original direction
  ///
  var normalized: Self {
    let length = self.vectorMagnitude;
    
    let unitVectorX = self.dx / length;
    let unitVectorY = self.dy / length;
    
    return .init(dx: unitVectorX, dy: unitVectorY);
  };
  
  var translateTransform: CGAffineTransform {
    .init(
      translationX: self.dx,
      y: self.dy
    );
  };

  func clamped(minMaxVelocity: CGFloat) -> Self {
    return .init(
      dx: self.dx.clamped(
        min: -minMaxVelocity,
        max:  minMaxVelocity
      ),
      dy: self.dy.clamped(
        min: -minMaxVelocity,
        max:  minMaxVelocity
      )
    );
  };
};
