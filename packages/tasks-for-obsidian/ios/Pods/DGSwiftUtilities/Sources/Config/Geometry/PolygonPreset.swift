//
//  PolygonPreset.swift
//  Experiments-Misc
//
//  Created by Dominic Go on 11/13/24.
//

import UIKit


public enum PolygonPreset: Equatable {
  case regularPolygon(numberOfSides: Int);
  
  case regularStarPolygon(
    numberOfSpikes: Int,
    innerRadius: CGFloat? = nil,
    spikeRadius: CGFloat? = nil
  );
  
  // MARK: - Functions
  // -----------------
  
  public func createRawPoints(inRect targetRect: CGRect) -> [CGPoint] {
    switch self {
      case let .regularPolygon(numberOfSides):
        let radius = targetRect.width / 2;
        
        return Self.createPointsForRegularPolygon(
          center: targetRect.centerPoint,
          radius: radius,
          numberOfSides: numberOfSides
        );
        
      case let .regularStarPolygon(numberOfSpikes, innerRadius, outerRadius):
        let outerRadius =
          outerRadius ?? targetRect.size.smallestDimension / 2;
          
        return Self.createPointsForStar(
          center: targetRect.centerPoint,
          outerRadius: outerRadius,
          innerRadius: innerRadius,
          numberOfPoints: numberOfSpikes
        );
    };
  };
  
  public func createPoints(
    inRect targetRect: CGRect,
    pointAdjustments: PointGroupAdjustment
  ) -> [CGPoint] {
  
    let points = self.createRawPoints(inRect: targetRect);
    return pointAdjustments.apply(toPoints: points, forRect: targetRect);
  };
  
  public func createPath(
    inRect targetRect: CGRect,
    pointAdjustments: PointGroupAdjustment,
    pointConnectionStrategy: PointConnectionStrategy
  ) -> UIBezierPath {
  
    let points = self.createPoints(
      inRect: targetRect,
      pointAdjustments: pointAdjustments
    );
    
    let pointsTransformed =
      pointAdjustments.applyPointTransform(toPoints: points);
    
    let path =  pointConnectionStrategy.createPath(
      forPoints: pointsTransformed,
      inRect: targetRect,
      pointAdjustments: pointAdjustments
    );
    
    pointAdjustments.applyPathTransform(toPath: path);
    return path;
  };
  
  public func createShape(
    forFrame targetRect: CGRect,
    pointAdjustments: PointGroupAdjustment,
    pointConnectionStrategy: PointConnectionStrategy
  ) -> CAShapeLayer {
  
    let path = self.createPath(
      inRect: targetRect,
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: pointConnectionStrategy
    );
    
    // assign the path to the shape
    let shapeLayer = CAShapeLayer();
    shapeLayer.path = path.cgPath;
    
    return shapeLayer;
  };
};

// MARK: - ShapePoints+StaticHelpers
// ---------------------------------

public extension PolygonPreset {

  static func createPointsForRegularPolygon(
    center: CGPoint,
    radius: CGFloat,
    numberOfSides: Int
  ) -> [CGPoint] {
    
    let angleIncrement = 360 / CGFloat(numberOfSides);
    
    return (0 ..< numberOfSides).map {
      let angle: Angle<CGFloat> = .degrees(CGFloat($0) * angleIncrement);
      
      return angle.getPointAlongCircle(
        withRadius: radius,
        usingCenter: center
      );
    };
  };
  
  static func createPointsForStar(
    center: CGPoint,
    outerRadius: CGFloat,
    innerRadius: CGFloat? = nil,
    numberOfPoints: Int
  ) -> [CGPoint] {
          
    let innerRadius = innerRadius ?? outerRadius / 2.5;
    
    let angleIncrement = 360 / CGFloat(numberOfPoints);
    let angleIncrementHalf = angleIncrement / 2;
    
    return (0 ..< numberOfPoints).reduce(into: []) {
      let index = CGFloat($1);
    
      let innerAngle: Angle<CGFloat> = .degrees(index * angleIncrement);
      
      let innerPoint = innerAngle.getPointAlongCircle(
        withRadius: innerRadius,
        usingCenter: center
      );
      
      $0.append(innerPoint);
      
      let outerAngle: Angle<CGFloat> =
        .degrees(innerAngle.degrees + angleIncrementHalf);
      
      let outerPoint = outerAngle.getPointAlongCircle(
        withRadius: outerRadius,
        usingCenter: center
      );
      
      $0.append(outerPoint);
    };
  };
};

