//
//  Array+CGPointHelpers.swift
//  Experiments-Misc
//
//  Created by Dominic Go on 11/13/24.
//

import Foundation


public extension Array where Element == CGPoint {

  func getBoundingBoxForPoints() -> CGRect {
    let valuesX = self.map { $0.x };
    let valuesY = self.map { $0.y };
    
    let minX = valuesX.min() ?? 0;
    let minY = valuesY.min() ?? 0;
    
    let maxX = valuesX.max() ?? 0;
    let maxY = valuesY.max() ?? 0;
    
    return .init(
      minX: minX,
      minY: minY,
      maxX: maxX,
      maxY: maxY
    );
  };
  
  /// translates all points by a given `dx` and `dy` relative to the
  /// bounding box.
  ///
  func translatePoints(dx: CGFloat, dy: CGFloat) -> [CGPoint] {
    let boundingBox = self.getBoundingBoxForPoints();
      
    // calculate the translation for the derived bounding box
    let translatedOrigin = CGPoint(
      x: boundingBox.origin.x + dx,
      y: boundingBox.origin.y + dy
    );
      
    // adjust each point by translation
    return self.map { point in
      let adjX = translatedOrigin.x - boundingBox.origin.x;
      let adjY = translatedOrigin.y - boundingBox.origin.y;
      
      return .init(
        x: point.x + adjX,
        y: point.y + adjY
      );
    };
  };

  func scalePointsToFit(
    targetRect: CGRect,
    shouldPreserveAspectRatio: Bool = false
  ) -> [Self.Element] {
    let boundingBox = self.getBoundingBoxForPoints();
    
    guard boundingBox != targetRect else {
      return self;
    };
    
    // calculate the scaling factors
    let scaleX = targetRect.width / boundingBox.width;
    let scaleY = targetRect.height / boundingBox.height;
    
    let minScaleFactor = Swift.min(scaleX, scaleY);
    
    let scaleXAdj = shouldPreserveAspectRatio
      ? minScaleFactor
      : scaleX;
      
    let scaleYAdj = shouldPreserveAspectRatio
      ? minScaleFactor
      : scaleY;
      
    // Create the scaled points
    var scaledPoints: [CGPoint] = [];
    for point in self {
      let scaledX = (point.x - boundingBox.minX) * scaleXAdj;
      let scaledXAdj = scaledX + targetRect.origin.x;
    
      let scaledY = (point.y - boundingBox.minY) * scaleYAdj;
      let scaledYAdj = scaledY + targetRect.origin.y;
      
      let scaledPoint: CGPoint = .init(x: scaledXAdj, y: scaledYAdj);
      scaledPoints.append(scaledPoint);
    };
    
    return scaledPoints;
  };
  
  func centerPoints(toTargetRect targetRect: CGRect) -> [CGPoint]{
    let boundingBox = self.getBoundingBoxForPoints();
    
    guard boundingBox.centerPoint != targetRect.centerPoint else {
      return self;
    };
    
    let boundingBoxCentered = boundingBox.centered(inOtherRect: targetRect);
    
    let translateX = boundingBoxCentered.origin.x - boundingBox.origin.x;
    let translateY = boundingBoxCentered.origin.y - boundingBox.origin.y;
    
    return self.translatePoints(
      dx: translateX,
      dy: translateY
    );
  };
};
