//
//  AuxiliaryPreviewTransitionConfig.swift
//  
//
//  Created by Dominic Go on 10/23/23.
//

import Foundation


public struct AuxiliaryPreviewTransitionConfig {

  public var keyframeConfigStart: AuxiliaryPreviewTransitionKeyframeConfig;
  public var keyframeConfigEnd: AuxiliaryPreviewTransitionKeyframeConfig;
  
  public init(transitionPreset: AuxiliaryPreviewTransitionPreset) {
    (self.keyframeConfigStart, self.keyframeConfigEnd) =
      transitionPreset.transitionKeyframeConfig;
  };

  // MARK: - Functions
  // -----------------
  
  mutating func reverseKeyframes(){
    let tempCopy = self;
    
    self.keyframeConfigEnd = tempCopy.keyframeConfigStart;
    self.keyframeConfigStart = tempCopy.keyframeConfigStart;
  };
  
  func getKeyframes(
    auxiliaryPreviewMetadata: AuxiliaryPreviewMetadata
  ) -> (
    keyframeStart: AuxiliaryPreviewTransitionKeyframe,
    keyframeEnd: AuxiliaryPreviewTransitionKeyframe
  ) {
  
    var keyframeStart = AuxiliaryPreviewTransitionKeyframe(
      keyframeCurrent: self.keyframeConfigStart,
      auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
    );
    
    keyframeStart.setValuesIfNeeded(
      usingAuxiliaryPreviewMetadata: auxiliaryPreviewMetadata
    );
    
    var keyframeEnd = AuxiliaryPreviewTransitionKeyframe(
      keyframeCurrent: self.keyframeConfigEnd,
      auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
    );
    
    keyframeEnd.setValuesIfNeeded(
      usingAuxiliaryPreviewMetadata: auxiliaryPreviewMetadata
    );
    
    keyframeEnd = AuxiliaryPreviewTransitionKeyframe(
      keyframeCurrent: self.keyframeConfigEnd,
      keyframePrevious: keyframeEnd,
      auxiliaryPreviewMetadata: auxiliaryPreviewMetadata
    );
    
    return (keyframeStart, keyframeEnd);
  };
};
