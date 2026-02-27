//
//  UIBezierPath+Helpers.swift
//  
//
//  Created by Dominic Go on 11/21/24.
//

import UIKit


public extension UIBezierPath {
      
  func applyOffset(offsetAmount: CGVector) {
    let translate = CGAffineTransform(
      translationX: offsetAmount.dx,
      y: offsetAmount.dy
    );
    
    self.apply(translate);
  };
  
  func applyScale(scaleX: CGFloat, scaleY: CGFloat){
    let scale = CGAffineTransform(scaleX: scaleX, y: scaleY);
    self.apply(scale);
  };
  
  func recenter(toPoint newCenter: CGPoint) {
    let bounds  = self.cgPath.boundingBox;
    let currentCenter = bounds.centerPoint;
    
    let displacement = currentCenter.getVector(pointingTo: newCenter);
    
    self.apply(
      displacement.translateTransform
    );
  };
  
  func scaleToFit(
    intoRect targetRect: CGRect,
    shouldPreserveAspectRatio: Bool,
    shouldCenter: Bool
  ) {
  
    let currentBounds = self.cgPath.boundingBox;
    
    let scaleToFitTransform = currentBounds.createScaleToFitTransform(
      intoRect: targetRect,
      shouldPreserveAspectRatio: shouldPreserveAspectRatio,
      shouldCenter: shouldCenter
    );
    
    self.apply(scaleToFitTransform);
  };
};
