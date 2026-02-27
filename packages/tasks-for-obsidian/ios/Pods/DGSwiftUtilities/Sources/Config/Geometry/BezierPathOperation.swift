//
//  BezierPathOperation.swift
//  
//
//  Created by Dominic Go on 11/21/24.
//

import UIKit


public enum BezierPathOperation: Equatable {

  case moveTo(point: CGPoint);
  
  case addLine(endPoint: CGPoint);
  
  case addCurve(
    endPoint: CGPoint,
    controlPoint1: CGPoint,
    controlPoint2: CGPoint
  );
  
  case addQuadCurve(
    endPoint: CGPoint,
    controlPoint: CGPoint
  );
  
  case close;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var rawPoints: [CGPoint] {
    switch self {
      case let .moveTo(point):
        return [point];
        
      case let .addLine(endPoint):
        return [endPoint];
      
      case let .addCurve(endPoint, controlPoint1, controlPoint2):
        return [endPoint, controlPoint1, controlPoint2];
        
      case let .addQuadCurve(endPoint, controlPoint):
        return [endPoint, controlPoint];
        
      case .close:
        return [];
    };
  };
  
  // MARK: - Functions
  // -----------------
  
  public func adjustPoints(
    usingBlock pointAdjustmentBlock: (CGPoint) -> CGPoint
  ) -> Self {
  
    switch self {
      case let .moveTo(point):
        let pointAdj = pointAdjustmentBlock(point);
        return .moveTo(point: pointAdj);
        
      case let .addLine(endPoint):
        let endPointAdj = pointAdjustmentBlock(endPoint);
        return .addLine(endPoint: endPointAdj);
      
      case let .addCurve(endPoint, controlPoint1, controlPoint2):
        let endPointAdj = pointAdjustmentBlock(endPoint);
        let controlPoint1Adj = pointAdjustmentBlock(controlPoint1);
        let controlPoint2Adj = pointAdjustmentBlock(controlPoint2);
        
        return .addCurve(
          endPoint: endPointAdj,
          controlPoint1: controlPoint1Adj,
          controlPoint2: controlPoint2Adj
        );
        
      case let .addQuadCurve(endPoint, controlPoint):
        let endPointAdj = pointAdjustmentBlock(endPoint);
        let controlPointAdj = pointAdjustmentBlock(controlPoint);
        
        return .addQuadCurve(
          endPoint: endPointAdj,
          controlPoint: controlPointAdj
        );
        
      case .close:
        return .close;
    };
  };
  
  public func apply(toPath path: UIBezierPath){
    switch self {
      case let .moveTo(point):
        path.move(to: point);
        
      case let .addLine(endPoint):
        path.addLine(to: endPoint);
      
      case let .addCurve(endPoint, controlPoint1, controlPoint2):
        path.addCurve(
          to: endPoint,
          controlPoint1: controlPoint1,
          controlPoint2: controlPoint2
        );
        
      case let .addQuadCurve(endPoint, controlPoint):
        path.addQuadCurve(to: endPoint, controlPoint: controlPoint);
        
      case .close:
        path.close();
    };
  };
};

// MARK: - Array+BezierPathOperationHelpers
// ----------------------------------------

public extension Array where Element == BezierPathOperation {
  
  var rawPoints: [CGPoint] {
    self.reduce(into: []) {
      $0 += $1.rawPoints;
    };
  };
  
  var path: UIBezierPath {
    let path = UIBezierPath();
    self.apply(toPath: path);
    
    return path;
  };
  
  var boundingBoxForRawPoints: CGRect {
    self.rawPoints.getBoundingBoxForPoints();
  };
  
  func apply(toPath path: UIBezierPath){
    self.forEach {
      $0.apply(toPath: path);
    };
  };
  
  /// translates all points by a given `dx` and `dy` relative to the
  /// bounding box.
  ///
  func translatePoints(dx: CGFloat, dy: CGFloat) -> [Self.Element] {
    let boundingBox = self.boundingBoxForRawPoints;
      
    // calculate the translation for the derived bounding box
    let translatedOrigin = CGPoint(
      x: boundingBox.origin.x + dx,
      y: boundingBox.origin.y + dy
    );
      
    // adjust each point by translation
    return self.map { pathOperation in
      let adjX = translatedOrigin.x - boundingBox.origin.x;
      let adjY = translatedOrigin.y - boundingBox.origin.y;
      
      return pathOperation.adjustPoints {
        .init(
          x: $0.x + adjX,
          y: $0.y + adjY
        )
      };
    };
  };

  func scalePointsToFit(
    targetRect: CGRect,
    shouldPreserveAspectRatio: Bool = false
  ) -> [Self.Element] {
  
    let boundingBox = self.boundingBoxForRawPoints;
    
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
      
    return self.map { pathOperation in
      pathOperation.adjustPoints {
        let scaledX = ($0.x - boundingBox.minX) * scaleXAdj;
        let scaledXAdj = scaledX + targetRect.origin.x;
      
        let scaledY = ($0.y - boundingBox.minY) * scaleYAdj;
        let scaledYAdj = scaledY + targetRect.origin.y;
        
        return .init(x: scaledXAdj, y: scaledYAdj);
      };
    };
  };
  
  func centerPoints(toTargetRect targetRect: CGRect) -> [Self.Element]{
    let boundingBox = self.boundingBoxForRawPoints;
    
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
