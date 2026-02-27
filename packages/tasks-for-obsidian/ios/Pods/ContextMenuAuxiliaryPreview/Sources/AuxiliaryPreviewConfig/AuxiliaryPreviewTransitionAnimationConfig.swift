//
//  AuxiliaryPreviewTransitionAnimationConfig.swift
//  
//
//  Created by Dominic Go on 11/8/23.
//

import UIKit
import DGSwiftUtilities


public struct AuxiliaryPreviewTransitionAnimationConfig {

  public static var `default`: Self = .init(
    delay: .zero,
    animatorConfig: .presetCurve(duration: 0.2, curve: .linear),
    transitionPreset: .fade
  );

  public var delay: TimeInterval;
  public var animatorConfig: AnimationConfig;
  
  public var transitionPreset: AuxiliaryPreviewTransitionPreset;
  public var transition: AuxiliaryPreviewTransitionConfig;
  
  public init(
    delay: TimeInterval,
    animatorConfig: AnimationConfig,
    transitionPreset: AuxiliaryPreviewTransitionPreset
  ) {
  
    self.delay = delay;
    self.animatorConfig = animatorConfig;
    
    self.transitionPreset = transitionPreset;
    self.transition = .init(transitionPreset: transitionPreset);
  };
};
