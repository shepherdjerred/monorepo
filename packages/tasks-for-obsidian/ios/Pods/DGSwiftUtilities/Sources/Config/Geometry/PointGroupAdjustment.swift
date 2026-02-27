//
//  PointGroupAdjustment.swift
//  
//
//  Created by Dominic Go on 11/21/24.
//

import UIKit


public struct PointGroupAdjustment: Equatable {

  public var shouldScaleToFitTargetRect: Bool;
  public var shouldPreserveAspectRatioWhenScaling: Bool;
  public var shouldCenterToFrameIfNeeded: Bool = true;
  
  /// pre transform, apply to generated points (before the path is created)
  /// * generally useful for rotating the "shape" without affecting sizing
  ///
  public var pointTransform: Transform3D? = nil;
  
  /// post transform, apply to shape (after the points are generated)
  /// * generally useful for scaling the "shape" when using curved/rounded
  ///   paths so that it fits the bounds better.
  ///
  public var pathTransform: Transform3D? = nil;
  
  // MARK: - Init
  // ------------
  
  public init(
    shouldScaleToFitTargetRect: Bool,
    shouldPreserveAspectRatioWhenScaling: Bool,
    shouldCenterToFrameIfNeeded: Bool = true,
    pointTransform: Transform3D? = nil,
    pathTransform: Transform3D? = nil
  ) {
    self.shouldScaleToFitTargetRect = shouldScaleToFitTargetRect;
    self.shouldPreserveAspectRatioWhenScaling = shouldPreserveAspectRatioWhenScaling;
    self.shouldCenterToFrameIfNeeded = shouldCenterToFrameIfNeeded;
    
    self.pointTransform = pointTransform;
    self.pathTransform = pathTransform;
  };
  
  // MARK: - Functions
  // -----------------
  
  public func apply(
    toPoints points: [CGPoint],
    forRect targetRect: CGRect
  ) -> [CGPoint] {
  
    // 3 bits, 8 possible combinations
    switch (
      shouldScaleToFitTargetRect,
      shouldPreserveAspectRatioWhenScaling,
      shouldCenterToFrameIfNeeded
    ) {
      // no scaling, centered
      case (false, _, true):
        return points.centerPoints(toTargetRect: targetRect);
      
      // scale to fit
      case (true, false, _):
        return points.scalePointsToFit(
          targetRect: targetRect,
          shouldPreserveAspectRatio: false
        );
      
      // scale and preserve aspect ratio, centered
      case (true, true, true):
        let pointsScaledToFit = points.scalePointsToFit(
          targetRect: targetRect,
          shouldPreserveAspectRatio: true
        );
        
        return pointsScaledToFit.centerPoints(toTargetRect: targetRect);
      
      // scale and preserve aspect ratio, no centering
      case (true, true, false):
        return points.scalePointsToFit(
          targetRect: targetRect,
          shouldPreserveAspectRatio: true
        );
        
      // no scaling or centering
      default:
        return points;
    };
  };
  
  public func apply(
    toPathOperations pathOperations: [BezierPathOperation],
    forRect targetRect: CGRect
  ) -> [BezierPathOperation] {
  
    // 3 bits, 8 possible combinations
    switch (
      shouldScaleToFitTargetRect,
      shouldPreserveAspectRatioWhenScaling,
      shouldCenterToFrameIfNeeded
    ) {
      // no scaling, centered
      case (false, _, true):
        return pathOperations.centerPoints(toTargetRect: targetRect);
      
      // scale to fit
      case (true, false, _):
        return pathOperations.scalePointsToFit(
          targetRect: targetRect,
          shouldPreserveAspectRatio: false
        );
      
      // scale and preserve aspect ratio, centered
      case (true, true, true):
        let pointsScaledToFit = pathOperations.scalePointsToFit(
          targetRect: targetRect,
          shouldPreserveAspectRatio: true
        );
        
        return pointsScaledToFit.centerPoints(toTargetRect: targetRect);
      
      // scale and preserve aspect ratio, no centering
      case (true, true, false):
        return pathOperations.scalePointsToFit(
          targetRect: targetRect,
          shouldPreserveAspectRatio: true
        );
        
      // no scaling or centering
      default:
        return pathOperations;
    };
  };
  
  public func apply(
    toPath path: UIBezierPath,
    forRect targetRect: CGRect
  ){
    
    // 3 bits, 8 possible combinations
    switch (
      shouldScaleToFitTargetRect,
      shouldPreserveAspectRatioWhenScaling,
      shouldCenterToFrameIfNeeded
    ) {
      // no scaling, centered
      case (false, _, true):
        path.recenter(toPoint: targetRect.centerPoint);
      
      // scale to fit
      case (true, false, _):
        path.scaleToFit(
          intoRect: targetRect,
          shouldPreserveAspectRatio: false,
          shouldCenter: true
        );
      
      // scale and preserve aspect ratio, centered
      case (true, true, true):
        path.scaleToFit(
          intoRect: targetRect,
          shouldPreserveAspectRatio: true,
          shouldCenter: true
        );
      
      // scale and preserve aspect ratio, no centering
      case (true, true, false):
        path.scaleToFit(
          intoRect: targetRect,
          shouldPreserveAspectRatio: true,
          shouldCenter: false
        );
        
      // no scaling or centering
      default:
        break;
    };
  };
  
  public func applyPointTransform(toPoints points: [CGPoint]) -> [CGPoint] {
    guard let pointTransform = self.pointTransform,
          pointTransform != .identity
    else {
      return points;
    };
    
    let transform = pointTransform.affineTransform;
    
    return points.map {
      $0.applying(transform);
    };
  };
  
  public func applyPathTransform(toPath path: UIBezierPath){
    guard let postTransform = self.pathTransform else {
      return;
    };
    
    let centerPoint = path.bounds.centerPoint;
    path.apply(postTransform.affineTransform);
    
    guard self.shouldCenterToFrameIfNeeded else {
      return;
    };
    
    path.recenter(toPoint: centerPoint);
  };
};

// MARK: - PointGroupAdjustment+StaticAlias
// ----------------------------------------

public extension PointGroupAdjustment {
  
  static var none: Self {
    .init(
      shouldScaleToFitTargetRect: false,
      shouldPreserveAspectRatioWhenScaling: false,
      shouldCenterToFrameIfNeeded: false
    );
  };
  
  static var scaleToFit: Self {
    .init(
      shouldScaleToFitTargetRect: true,
      shouldPreserveAspectRatioWhenScaling: true,
      shouldCenterToFrameIfNeeded: true
    );
  };
  
  static var scaleToFill: Self {
    .init(
      shouldScaleToFitTargetRect: true,
      shouldPreserveAspectRatioWhenScaling: false,
      shouldCenterToFrameIfNeeded: true
    );
  };

};
