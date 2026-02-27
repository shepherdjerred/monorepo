//
//  AuxiliaryPreviewTransitionKeyframe.swift
//  
//
//  Created by Dominic Go on 10/23/23.
//

import UIKit
import DGSwiftUtilities


/// Derived from: `AuxiliaryPreviewTransitionKeyframeConfig`
public struct AuxiliaryPreviewTransitionKeyframe {

  public var opacity: CGFloat;
  public var transform: Transform3D;
  
  public var auxiliaryPreviewPreferredWidth: CGFloat?;
  public var auxiliaryPreviewPreferredHeight: CGFloat?;
  
  public init(
    keyframeCurrent: AuxiliaryPreviewTransitionKeyframeConfig,
    keyframePrevious keyframePrev: Self? = nil,
    auxiliaryPreviewMetadata: AuxiliaryPreviewMetadata
  ) {
    
    self.opacity =
         keyframeCurrent.opacity
      ?? keyframePrev?.opacity
      ?? 1;
      
    self.transform = {
      let prevTransform = keyframePrev?.transform ?? .default;
    
      guard var nextTransform = keyframeCurrent.transform else {
        return prevTransform;
      };
      
      nextTransform.setNonNilValues(with: prevTransform);
      return nextTransform;
    }();
    
    self.auxiliaryPreviewPreferredWidth = {
      let widthCurrent = keyframeCurrent.auxiliaryPreviewPreferredWidth?.compute(
        computingForSizeKey: \.width,
        usingContext: auxiliaryPreviewMetadata.sizeValueContext
      );
      
      return widthCurrent ?? keyframePrev?.auxiliaryPreviewPreferredWidth;
    }();
    
    self.auxiliaryPreviewPreferredHeight = {
      let heightCurrent = keyframeCurrent.auxiliaryPreviewPreferredHeight?.compute(
        computingForSizeKey: \.height,
        usingContext: auxiliaryPreviewMetadata.sizeValueContext
      );
      
      return heightCurrent ?? keyframePrev?.auxiliaryPreviewPreferredHeight;
    }();
  };
  
  mutating func setValuesIfNeeded(
    usingAuxiliaryPreviewMetadata auxiliaryPreviewMetadata: AuxiliaryPreviewMetadata
  ) {
    
    if self.auxiliaryPreviewPreferredWidth == nil {
      self.auxiliaryPreviewPreferredWidth =
        auxiliaryPreviewMetadata.computedWidthAdjusted;
    };
    
    if self.auxiliaryPreviewPreferredHeight == nil {
      self.auxiliaryPreviewPreferredHeight =
        auxiliaryPreviewMetadata.computedHeight;
    };
  };
  
  public func apply(
    auxiliaryPreviewView: UIView,
    auxiliaryPreviewMetadata: AuxiliaryPreviewMetadata
  ){
    
    var shouldUpdateConstraints = false;
  
    auxiliaryPreviewView.alpha = self.opacity;
    
    auxiliaryPreviewView.layer.transform = {
      var transform = self.transform;
      
      switch auxiliaryPreviewMetadata.verticalAnchorPosition {
        case .top:
          transform.translateY = -transform.translateY;
          
        case .bottom:
          transform.rotateX = .degrees(-transform.rotateX.degrees);
      };
      
      return transform.transform;
    }();
    
    block:
    if let heightConstraint = auxiliaryPreviewView.heightConstraint {
      let heightPrev = heightConstraint.constant;
      
      guard let heightNext = self.auxiliaryPreviewPreferredHeight,
            heightNext != heightPrev
      else { break block };
      
      heightConstraint.constant = heightNext;
      shouldUpdateConstraints = true;
    };
    
    block:
    if let widthConstraint = auxiliaryPreviewView.widthConstraint {
      let widthPrev = widthConstraint.constant;
      
      guard let widthNext = self.auxiliaryPreviewPreferredWidth,
            widthNext != widthPrev
      else { break block };
      
      widthConstraint.constant = widthNext;
      shouldUpdateConstraints = true;
    };
    
    if shouldUpdateConstraints {
      auxiliaryPreviewView.updateConstraints();
      auxiliaryPreviewView.setNeedsLayout();
    };
  };
};
