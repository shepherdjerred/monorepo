//
//  CGSize+Helpers.swift
//  swift-programmatic-modal
//
//  Created by Dominic Go on 5/19/23.
//

import UIKit

public extension CGRect {
  
  var isNaN: Bool {
    return (
         self.origin.x.isNaN
      || self.origin.y.isNaN
      || self.size.width.isNaN
      || self.size.height.isNaN
    );
  };
  
  var nilIfEmpty: Self? {
    self.isEmpty ? nil : self;
  };
  
  var centerPoint: CGPoint {
    .init(
      x: self.midX,
      y: self.midY
    );
  };
  
  var topMidPoint: CGPoint {
    .init(
      x: self.midX,
      y: self.minY
    );
  };
  
  var bottomMidPoint: CGPoint {
    .init(
      x: self.midX,
      y: self.maxY
    );
  };
  
  var leftMidPoint: CGPoint {
    .init(
      x: self.minX,
      y: self.midY
    );
  };
  
  var rightMidPoint: CGPoint {
    .init(
      x: self.maxX,
      y: self.midY
    );
  };
  
  var topLeftPoint: CGPoint {
    .init(
      x: self.minX,
      y: self.minY
    );
  };
  
  var topRightPoint: CGPoint {
    .init(
      x: self.maxX,
      y: self.minY
    );
  };
  
  var bottomLeftPoint: CGPoint {
    .init(
      x: self.minX,
      y: self.maxY
    );
  };
  
  var bottomRightPoint: CGPoint {
    .init(
      x: self.maxX,
      y: self.maxY
    );
  };

  mutating func setPoint(
    minX: CGFloat? = nil,
    minY: CGFloat? = nil
  ){
    guard !(minX == nil && minY == nil) else {
      return;
    };
    
    self.origin = CGPoint(
      x: minX ?? self.minX,
      y: minY ?? self.minY
    );
  };
  
  mutating func setPoint(
    midX: CGFloat? = nil,
    midY: CGFloat? = nil
  ){
    guard !(midX == nil && midY == nil) else {
      return;
    };
    
    let newX: CGFloat = {
      guard let midX = midX else {
        return self.minX;
      };
      
      return midX - (self.width / 2);
    }();
    
    let newY: CGFloat = {
      guard let midY = midY else {
        return self.minY;
      };
      
      return midY - (self.height / 2);
    }();
    
    self.origin = CGPoint(x: newX, y: newY);
  };
  
  mutating func setPoint(
    maxX: CGFloat? = nil,
    maxY: CGFloat? = nil
  ){
    guard !(maxX == nil && maxY == nil) else {
      return;
    };
    
    let newX: CGFloat = {
      guard let maxX = maxX else {
        return self.minX;
      };
      
      return maxX - self.width;
    }();
    
    let newY: CGFloat = {
      guard let maxY = maxY else {
        return self.minY;
      };
      
      return maxY - self.height;
    }();
    
    self.origin = CGPoint(x: newX, y: newY);
  };
  
  mutating func setPoint(origin: CGPoint){
    self.setPoint(minX: origin.x, minY: origin.y);
  };
  
  mutating func setPoint(center: CGPoint) {
    let newOriginX = center.x - (self.width / 2);
    let newOriginY = center.y - (self.height / 2);
    
    self.setPoint(minX: newOriginX, minY: newOriginY);
  };
  
  func scale(toNewSize newSize: CGSize) -> Self {
    let center = self.centerPoint;

    let newX = center.x - (newSize.width / 2);
    let newY = center.y - (newSize.height / 2);
    
    return .init(
      origin: .init(x: newX, y: newY),
      size: newSize
    );
  };
  
  func scale(
    widthBy widthScaleFactor: CGFloat,
    heightBy heightScaleFactor: CGFloat
  ) -> Self {
    
    let newWidth = self.width * widthScaleFactor;
    let newHeight = self.height * heightScaleFactor;
    
    let newSize: CGSize = .init(width: newWidth, height: newHeight);
    let scaledRect = self.scale(toNewSize: newSize);

    return scaledRect;
  };
  
  func scale(byScaleFactor scaleFactor: CGFloat) -> Self {
    return self.scale(widthBy: scaleFactor, heightBy: scaleFactor);
  };
  
  func centered(inOtherRect otherRect: CGRect) -> CGRect {
    var copy = self;
    copy.setPoint(center: otherRect.centerPoint);
    
    return copy;
  };
  
  func createScaleToFitTransform(
    intoRect targetRect: CGRect,
    shouldPreserveAspectRatio: Bool,
    shouldCenter: Bool
  ) -> CGAffineTransform {
  
    var transformations: [CGAffineTransform] = [.identity];
    
    let transformScale = self.size.createScaleTransform(
      scalingTo: targetRect.size,
      shouldPreserveAspectRatio: shouldPreserveAspectRatio
    );
    
    transformations.append(transformScale);
    let newBoundsRaw = self.applying(transformScale);
    
    if shouldCenter {
      let displacement = newBoundsRaw.centerPoint.getVector(
        pointingTo: targetRect.centerPoint
      );
      
      transformations.append(displacement.translateTransform);
    };
    
    return transformations.concatenateTransforms()!;
  };
};
