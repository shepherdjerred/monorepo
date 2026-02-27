//
//  Line.swift
//  
//
//  Created by Dominic Go on 11/18/24.
//

import Foundation

public struct Line: Equatable {

  // MARK: - Properties
  // ------------------
  
  public var startPoint: CGPoint;
  public var endPoint: CGPoint;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var distance: CGFloat {
    let deltaX = endPoint.x - startPoint.x;
    let deltaY = endPoint.y - startPoint.y;

    return sqrt(deltaX * deltaX + deltaY * deltaY);
  };
  
  public var midPoint: CGPoint {
    (self.startPoint + self.endPoint) / 2;
  };
  
  public var slope: CGFloat {
    let delta = self.startPoint - self.endPoint;
    return delta.y / delta.x;
  };
  
  public var reversed: Self {
    .init(
      startPoint: self.endPoint,
      endPoint: self.startPoint
    );
  };
  
  // MARK: - Init
  // ------------
  
  public init(startPoint: CGPoint, endPoint: CGPoint) {
    self.startPoint = startPoint;
    self.endPoint = endPoint;
  };
  
  // MARK: - Functions
  // -----------------
  
  public func traverse(byPercent percentToTraverse: CGFloat) -> CGPoint {
    CGPoint.lerp(
      valueStart: self.startPoint,
      valueEnd: endPoint,
      percent: percentToTraverse
    );
  };
  
  public func traverse(byDistance distanceToTraverse: CGFloat) -> (
    percentTraversed: CGFloat,
    stopPoint: CGPoint
  ) {
    let totalDistance = self.distance;
    let percentTraversed = distanceToTraverse / totalDistance;
    
    let stopPoint = self.traverse(byPercent: percentTraversed);
    return (percentTraversed, stopPoint);
  };
};
