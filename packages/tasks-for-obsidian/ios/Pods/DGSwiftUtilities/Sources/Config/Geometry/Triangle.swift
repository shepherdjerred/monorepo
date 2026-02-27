//
//  Triangle.swift
//  
//
//  Created by Dominic Go on 11/17/24.
//

import Foundation

/// ```
///            top point
///                +
///               / \
/// leading -->  /   \    < trailing
/// side        /     \     side
///            /       \
/// leading > +---------+ < trailing
/// point          ^        point
///              bottom
///              side
/// ```
///
public struct Triangle: Equatable {

  // MARK: - Properties
  // ------------------

  public var topPoint: CGPoint;
  public var leadingPoint: CGPoint;
  public var trailingPoint: CGPoint;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var leadingSide: Line {
    .init(startPoint: self.topPoint, endPoint: self.leadingPoint);
  };
  
  public var trailingSide: Line {
    .init(startPoint: self.topPoint, endPoint: self.trailingPoint);
  };
  
  public var bottomSide: Line {
    .init(startPoint: self.leadingPoint, endPoint: self.trailingPoint);
  };
  
  public var centerLine: Line {
    let bottomMidPoint = self.bottomSide.midPoint;
    return .init(startPoint: self.topPoint, endPoint: bottomMidPoint);
  };
  
  public var height: CGFloat {
    let bottomMidPoint = self.bottomSide.midPoint;
    
    let distanceSigned =
      self.topPoint.getDistance(fromOtherPoint: bottomMidPoint);
      
    return floor(distanceSigned);
  };
  
  public var width: CGFloat {
    self.bottomSide.distance;
  };
  
  public var centroid: CGPoint {
    let sumTotalOfAllPoints =
      self.topPoint + self.leadingPoint + self.trailingPoint;
      
    return sumTotalOfAllPoints / 3;
  };
  
  public init(
    topPoint: CGPoint,
    leadingPoint: CGPoint,
    trailingPoint: CGPoint
  ) {
    self.topPoint = topPoint;
    self.leadingPoint = leadingPoint;
    self.trailingPoint = trailingPoint;
  };
  
  /// Resize triangle to new height, preserving slope, and topmost point
  /// (i.e. the resizing is pinned to the top).
  ///
  ///    /\          /\        /\
  ///   /  \   ->   /  \  ->  '--'
  ///  /    \      '----'
  /// '------'
  ///
  public func resizedTriangleRelativeToTopPoint(
    toNewHeight newHeight: CGFloat
  ) -> Self {
  
    let centerLineCurrent = self.centerLine;
    
    let (percentTraversed, _) =
      centerLineCurrent.traverse(byDistance: newHeight);
      
    let leadingPointNext =
      self.leadingSide.traverse(byPercent: percentTraversed);

    let trailingPointNext =
      self.trailingSide.traverse(byPercent: percentTraversed);
    
    return .init(
      topPoint: self.topPoint,
      leadingPoint: leadingPointNext,
      trailingPoint: trailingPointNext
    );
  };
};
