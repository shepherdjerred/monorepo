//
//  ShapePreset.swift
//  
//
//  Created by Dominic Go on 11/20/24.
//

import UIKit


public enum ShapePreset: Equatable {
  
  case regularPolygon(
    polygonPreset: PolygonPreset,
    pointAdjustments: PointGroupAdjustment,
    pointConnectionStrategy: PointConnectionStrategy
  );
  
  case rectRoundedCornersVariadic(
    cornerRadiusTopLeft: CGFloat,
    cornerRadiusTopRight: CGFloat,
    cornerRadiusBottomLeft: CGFloat,
    cornerRadiusBottomRight: CGFloat
  );
  
  case oval;
  case circle;
  case semicircle;
  
  // MARK: - Functions
  // -----------------
  
  public func createPath(inRect targetRect: CGRect) -> UIBezierPath {
    switch self {
      case let .regularPolygon(
        polygonPreset,
        pointAdjustments,
        pointConnectionStrategy
      ):
        return polygonPreset.createPath(
          inRect: targetRect,
          pointAdjustments: pointAdjustments,
          pointConnectionStrategy: pointConnectionStrategy
        );
        
      case let .rectRoundedCornersVariadic(
        cornerRadiusTopLeft,
        cornerRadiusTopRight,
        cornerRadiusBottomLeft,
        cornerRadiusBottomRight
      ):
        let minCornerRadius = 0.01;
        return .init(
          shouldRoundRect: targetRect,
          topLeftRadius: max(minCornerRadius, cornerRadiusTopLeft),
          topRightRadius: max(minCornerRadius, cornerRadiusTopRight),
          bottomLeftRadius: max(minCornerRadius, cornerRadiusBottomLeft),
          bottomRightRadius: max(minCornerRadius, cornerRadiusBottomRight)
        );
        
      case .oval:
        return .init(ovalIn: targetRect);
        
      case .circle:
        let smallestDimension = targetRect.size.smallestDimension;
        
        let rectSquare = targetRect.scale(toNewSize: .init(
          width: smallestDimension,
          height: smallestDimension
        ));
        
        let path = UIBezierPath(ovalIn: rectSquare);
        return path;
        
      case .semicircle:
        let radius = targetRect.width / 2;
        let circleCenter = targetRect.bottomMidPoint;
        
        let startAngle: Angle = .degrees(0);
        let endAngle: Angle = .degrees(180);
        
        let path = UIBezierPath();
        path.move(to: targetRect.bottomRightPoint);
        
        path.addArc(
          withCenter: circleCenter,
          radius: radius,
          startAngle: startAngle.radians,
          endAngle: endAngle.radians,
          clockwise: false
        );
        
        path.addLine(to: targetRect.bottomLeftPoint);
        path.close();
        
        return path;
    };
  };
  
  public func createShape(inRect targetRect: CGRect) -> CAShapeLayer {
    let path = self.createPath(inRect: targetRect);
    
    let shape = CAShapeLayer();
    shape.path = path.cgPath;
    
    return shape;
  };
};

// MARK: - Static Alias
// --------------------

public extension ShapePreset {

  static var none: Self = .rectRoundedCornersVariadic(
    cornerRadiusTopLeft: .leastNonzeroMagnitude,
    cornerRadiusTopRight: .leastNonzeroMagnitude,
    cornerRadiusBottomLeft: .leastNonzeroMagnitude,
    cornerRadiusBottomRight: .leastNonzeroMagnitude
  );
  
  static func rectRoundedUniform(cornerRadius: CGFloat) -> Self {
    .rectRoundedCornersVariadic(
      cornerRadiusTopLeft: cornerRadius,
      cornerRadiusTopRight: cornerRadius,
      cornerRadiusBottomLeft: cornerRadius,
      cornerRadiusBottomRight: cornerRadius
    );
  };
  
  // MARK: - `PolygonPreset`
  // -----------------------
  
  static func regularPolygon(
    numberOfSides: Int,
    pointConnectionStrategy: PointConnectionStrategy,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: numberOfSides),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: pointConnectionStrategy
    );
  };
  
  static func regularStarPolygon(
    numberOfSpikes: Int,
    innerRadius: CGFloat? = nil,
    spikeRadius: CGFloat,
    pointConnectionStrategy: PointConnectionStrategy,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularStarPolygon(
        numberOfSpikes: numberOfSpikes,
        innerRadius: innerRadius,
        spikeRadius: spikeRadius
      ),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: pointConnectionStrategy
    );
  };
  
  static func regularPolygonWithUniformRoundedCorners(
    numberOfSides: Int,
    uniformCornerRadius: CGFloat,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: numberOfSides),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .roundedCornersUniform(
        cornerRadius: uniformCornerRadius
      )
    );
  };
  
  static func regularStarPolygonWithRoundedCorners(
    numberOfSpikes: Int,
    innerRadius: CGFloat? = nil,
    spikeRadius: CGFloat? = nil,
    innerCornerRadius: CGFloat,
    spikeCornerRadius: CGFloat,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularStarPolygon(
        numberOfSpikes: numberOfSpikes,
        innerRadius: innerRadius,
        spikeRadius: spikeRadius
      ),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .roundedCornersCustom { _, index, _ in
        let isSpike = index % 2 == 1;
        return isSpike
          ? spikeCornerRadius
          : innerCornerRadius;
      }
    );
  };
    
  // MARK: - `PolygonPreset` (Straight)
  // ----------------------------------
  
  static func regularTriangle(pointAdjustments: PointGroupAdjustment) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 3),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .straight
    );
  };
  
  static func regularDiamond(pointAdjustments: PointGroupAdjustment) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 4),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .straight
    );
  };
  
  static func regularSquare(pointAdjustments: PointGroupAdjustment) -> Self {
    var pointTransform = pointAdjustments.pointTransform ?? .identity;
    
    pointTransform.append(
      otherTransform: .init(rotateZ: .degrees(45))
    );
    
    var pointAdjustments = pointAdjustments;
    pointAdjustments.pointTransform = pointTransform;
  
    return .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 4),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .straight
    );
  };
  
  static func regularPentagon(pointAdjustments: PointGroupAdjustment) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 5),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .straight
    );
  };
  
  static func regularHexagon(pointAdjustments: PointGroupAdjustment) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 6),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .straight
    );
  };
  
  static func regularHeptagon(pointAdjustments: PointGroupAdjustment) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 7),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .straight
    );
  };
  
  static func regularOctagon(pointAdjustments: PointGroupAdjustment) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 8),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .straight
    );
  };
  
  // MARK: - `PolygonPreset` (Rounded Uniform)
  // -----------------------------------------
  
  static func regularTriangleRoundedUniform(
    cornerRadius: CGFloat,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 3),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .roundedCornersUniform(cornerRadius: cornerRadius)
    );
  };
  
  static func regularDiamondRoundedUniform(
    cornerRadius: CGFloat,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 4),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .roundedCornersUniform(cornerRadius: cornerRadius)
    );
  };
  
  static func regularSquareRoundedUniform(
    cornerRadius: CGFloat,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    var pointTransform = pointAdjustments.pointTransform ?? .identity;
    
    pointTransform.append(
      otherTransform: .init(rotateZ: .degrees(45))
    );
    
    var pointAdjustments = pointAdjustments;
    pointAdjustments.pointTransform = pointTransform;
  
    return .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 4),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .roundedCornersUniform(cornerRadius: cornerRadius)
    );
  };
  
  static func regularPentagonRoundedUniform(
    cornerRadius: CGFloat,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 5),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .roundedCornersUniform(cornerRadius: cornerRadius)
    );
  };
  
  static func regularHexagonRoundedUniform(
    cornerRadius: CGFloat,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 6),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .roundedCornersUniform(cornerRadius: cornerRadius)
    );
  };
  
  static func regularHeptagonRoundedUniform(
    cornerRadius: CGFloat,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 7),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .roundedCornersUniform(cornerRadius: cornerRadius)
    );
  };
  
  static func regularOctagonRoundedUniform(
    cornerRadius: CGFloat,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 8),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .roundedCornersUniform(cornerRadius: cornerRadius)
    );
  };
  
  // MARK: - `PolygonPreset` (Continuous Curved Corners)
  // ---------------------------------------------------
  
  static func regularTriangleWithContinuousCurves(
    curvinessAmount: CGFloat,
    curveHeightOffset: CGFloat = 0,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 3),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .continuousCurvedCorners(
        curvinessAmount: curvinessAmount,
        curveHeightOffset: curveHeightOffset
      )
    );
  };
  
  static func regularDiamondWithContinuousCurves(
    curvinessAmount: CGFloat,
    curveHeightOffset: CGFloat = 0,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 4),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .continuousCurvedCorners(
        curvinessAmount: curvinessAmount,
        curveHeightOffset: curveHeightOffset
      )
    );
  };
  
  static func regularSquareWithContinuousCurves(
    curvinessAmount: CGFloat,
    curveHeightOffset: CGFloat = 0,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    var pointTransform = pointAdjustments.pointTransform ?? .identity;
    
    pointTransform.append(
      otherTransform: .init(rotateZ: .degrees(45))
    );
    
    var pointAdjustments = pointAdjustments;
    pointAdjustments.pointTransform = pointTransform;
  
    return .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 4),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .continuousCurvedCorners(
        curvinessAmount: curvinessAmount,
        curveHeightOffset: curveHeightOffset
      )
    );
  };
  
  static func regularPentagonWithContinuousCurves(
    curvinessAmount: CGFloat,
    curveHeightOffset: CGFloat = 0,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 5),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .continuousCurvedCorners(
        curvinessAmount: curvinessAmount,
        curveHeightOffset: curveHeightOffset
      )
    );
  };
  
  static func regularHexagonWithContinuousCurves(
    curvinessAmount: CGFloat,
    curveHeightOffset: CGFloat = 0,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 6),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .continuousCurvedCorners(
        curvinessAmount: curvinessAmount,
        curveHeightOffset: curveHeightOffset
      )
    );
  };
  
  static func regularHeptagonWithContinuousCurves(
    curvinessAmount: CGFloat,
    curveHeightOffset: CGFloat = 0,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 7),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .continuousCurvedCorners(
        curvinessAmount: curvinessAmount,
        curveHeightOffset: curveHeightOffset
      )
    );
  };
  
  static func regularOctagonWithContinuousCurves(
    curvinessAmount: CGFloat,
    curveHeightOffset: CGFloat = 0,
    pointAdjustments: PointGroupAdjustment
  ) -> Self {
    .regularPolygon(
      polygonPreset: .regularPolygon(numberOfSides: 8),
      pointAdjustments: pointAdjustments,
      pointConnectionStrategy: .continuousCurvedCorners(
        curvinessAmount: curvinessAmount,
        curveHeightOffset: curveHeightOffset
      )
    );
  };
};
