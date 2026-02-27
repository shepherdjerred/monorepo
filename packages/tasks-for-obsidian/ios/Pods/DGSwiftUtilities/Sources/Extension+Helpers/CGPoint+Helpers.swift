//
//  CGPoint+Helpers.swift
//  
//
//  Created by Dominic Go on 11/15/24.
//

import Foundation


public extension CGPoint {
  
  /// for convenience, math operations are directly done between points (bc
  /// it's a bit clunky to have to use 2 diff. types).
  ///
  /// however, after doing math operations on the points, it is more idiomatic
  /// to represent/store it as a vector as it's final type.
  ///
  /// this signals that it's not a "concrete point", and prevents accidental
  /// usage.
  ///
  /// * for example, you get the diff. between `pointA` and `pointB` and store
  ///   the point as `vectorAB`.
  ///
  /// * you then use `vectorAB` to displace `pointC`.
  ///
  /// * although a bit cumbersome, this signals the intent more clearly;
  ///   `vectorAB` is not a point! use it to displace other points!
  ///
  var asVector: CGVector {
    .init(dx: self.x, dy: self.y);
  };
  
  func createLine(toPoint otherPoint: Self) -> Line {
    .init(startPoint: self, endPoint: otherPoint);
  };

  func getDistance(fromOtherPoint otherPoint: Self) -> CGFloat {
    let line = self.createLine(toPoint: otherPoint);
    return line.distance;
  };
  
  /// calculate angle of point with respect to the center
  func getAngleAlongCircle(withCenter center: Self) -> Angle<CGFloat> {
    let deltaX = self.x - center.x;
    let deltaY = self.y - center.y;
    
    let angleInRadians = atan2(deltaY, deltaX);
    return .radians(angleInRadians).normalized;
  };
  
  func getMidpoint(betweenOtherPoint otherPoint: Self) -> Self {
    let line = self.createLine(toPoint: otherPoint);
    return line.midPoint;
  };
  
  func getMidPointAlongsideArc(
    withRadius radius: CGFloat? = nil,
    forOtherPoint trailingPoint: Self,
    usingCenter center: Self
  ) -> Self {
  
    let radius = radius ?? self.getDistance(fromOtherPoint: center);
    
    let leadingAngle = self.getAngleAlongCircle(withCenter: center);
    let trailingAngle = trailingPoint.getAngleAlongCircle(withCenter: center);

    let midAngle = leadingAngle.computeMidAngle(otherAngle: trailingAngle);
    
    return midAngle.getPointAlongCircle(
      withRadius: radius,
      usingCenter: center
    );
  };
  
  func getBezierControlPoint(
    forOtherPoint otherPoint: CGPoint,
    withRadius cornerRadius: CGFloat
  ) -> Self {
    
    let distanceToOtherPoint = self.getDistance(fromOtherPoint: otherPoint);
    
    let deltaX = otherPoint.x - self.x;
    let deltaY = otherPoint.y - self.y;
  
    let offsetX = cornerRadius * deltaX / distanceToOtherPoint;
    let offsetY = cornerRadius * deltaY / distanceToOtherPoint;

    return .init(x: offsetX, y: offsetY);
  };
  
  /// the diff. from 2 points
  /// * also useful for getting the direction vector
  ///
  func getDelta(fromOtherPoint otherPoint: Self) -> Self {
    self - otherPoint;
  };
  
  /// `self -> otherPoint`
  func getVector(pointingTo headPoint: CGPoint) -> CGVector{
    let delta = headPoint - self;
    return .init(dx: delta.x, dy: delta.y);
  };
  
  /// `otherPoint -> self`
  func getVector(pointingFrom tailPoint: CGPoint) -> CGVector{
    let delta = self - tailPoint;
    return .init(dx: delta.x, dy: delta.y);
  };
  
  func getSlope(relativeTo otherPoint: Self) -> CGFloat {
    let line = self.createLine(toPoint: otherPoint);
    return line.slope;
  };

  /// Solve for the intersection point of two lines.
  ///
  /// The first line (`lineA`) passes through `self` with slope `slopeA`.
  /// The second line (`lineB`) passes through `pointB` with slope `slopeB`.
  ///
  /// Solve for `intersection`:
  /// ```
  ///         self
  ///           +
  ///            \  lineA
  ///             \
  ///              \
  ///  pointB --+---+-- intersection
  ///                \
  ///
  ///            lineB
  /// ```
  ///
  /// - Parameters:
  ///   - slopeA: Slope of the line passing through `self`.
  ///   - pointB: A point on the second line.
  ///   - slopeB: Slope of the second line.
  ///
  /// - Returns: The intersection point, or `nil` if the lines are parallel.
  ///
  func findIntersection(
    withSlopeForCurrentPoint slopeA: CGFloat,
    betweenPointB pointB: Self,
    withSlope slopeB: CGFloat
  ) -> Self? {

    // check if the slopes are parallel (no intersection)
    if slopeA == slopeB {
      return nil;
    };
    
    /// find the equation of the line passing through `pointA` (`self`) with
    /// the given slope (`slopeA`).
    ///
    /// define formula...
    /// point-slope form:       `y - y1 = m(x - x1)`
    /// rearrange, solve for y: `y = mx - mx1 + y1`
    ///
    /// plug in values...
    /// point-slope form:       `y - self.y = slopeA * (x - self.x)`
    /// rearrange, solve for y: `y = slopeA * x - (slopeA * self.x) + self.y`
    ///
    let equationForLineA = { (x: CGFloat) in
      slopeA * (x - self.x) + self.y;
    };
    
    /// solve the system of equations:
    /// `equationForLineA(x) = equationForLineB(x)`
    ///
    /// expand:
    /// `m1 * (x - x1) + y1 = m2 * (x - x2) + y2`
    ///
    /// plugin values:
    /// `slopeA * (x - self.x) + self.y = slopeB * (x - pointB.x) + pointB.y`
    ///
    /// rearrange to solve for x:
    /// `m1 * x - m1 * x1 + y1 = m2 * x - m2 * x2 + y2`
    /// `m1 * x - m2 * x = m1 * x1 - y1 - m2 * x2 + y2`
    /// `x * (m1 - m2) = m1 * x1 - y1 - m2 * x2 + y2`
    /// `x = (m1 * x1 - y1 - m2 * x2 + y2) / (m1 - m2)`
    ///
    /// plug in values:
    /// ```
    ///     (slopeA * self.x - self.y - slopeB * pointB.x + pointB.y)
    /// x = ---------------------------------------------------------
    ///                       (slopeA - slopeB)
    /// ```
    ///
    let intersectionX: CGFloat? = {
      let denominator = slopeA - slopeB;
      guard denominator > 0 else {
        return 0;
      };
      
      let numerator =
        (slopeA * self.x) - self.y - (slopeB * pointB.x) + pointB.y;
        
      return numerator / denominator;
    }();
    
    guard let intersectionX = intersectionX else {
      return nil;
    };
    
    // solve for the y-coordinate using the first line's equation
    let intersectionY = equationForLineA(intersectionX);
    
    return .init(x: intersectionX, y: intersectionY);
  };
  
  func traveseLine(
    withEndPoint endPoint: CGPoint,
    byDistance distanceToTraverse: CGFloat
  ) -> Self {
  
    let totalDistance = self.getDistance(fromOtherPoint: endPoint);
    let percentTraversed = distanceToTraverse / totalDistance;
    
    let stopPoint = Self.lerp(
      valueStart: self,
      valueEnd: endPoint,
      percent: percentTraversed
    );
    
    return stopPoint;
  };
};
