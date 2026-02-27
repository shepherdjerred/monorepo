//
//  CGSize+Helpers.swift
//  react-native-ios-modal
//
//  Created by Dominic Go on 4/29/23.
//

import UIKit

public extension CGSize {

  var isZero: Bool {
    self == .zero || (self.width == 0 && self.height == 0);
  };
  
  var smallestDimension: CGFloat {
    min(self.width, self.height);
  };
  
  var largestDimension: CGFloat {
    max(self.width, self.height);
  };
  
  func getScaleFactor(
    scalingTo newScale: Self,
    shouldPreserveAspectRatio: Bool
  ) -> (
    scaleX: CGFloat,
    scaleY: CGFloat
  ) {
    let scaleFactorWidth = newScale.width / newScale.width;
    let scaleFactorHeight = newScale.height / newScale.height;
    
    guard shouldPreserveAspectRatio  else {
      return (scaleFactorWidth, scaleFactorHeight);
    };
    
    let minScaleFactor = min(scaleFactorWidth, scaleFactorHeight);
    return (minScaleFactor, minScaleFactor);
  };
  
  func createScaleTransform(
    scalingTo newScale: Self,
    shouldPreserveAspectRatio: Bool
  ) -> CGAffineTransform {
  
    let scaleFactor = self.getScaleFactor(
      scalingTo: newScale,
      shouldPreserveAspectRatio: shouldPreserveAspectRatio
    );
    
    return .init(
      scaleX: scaleFactor.scaleX,
      y: scaleFactor.scaleY
    );
  };
};
