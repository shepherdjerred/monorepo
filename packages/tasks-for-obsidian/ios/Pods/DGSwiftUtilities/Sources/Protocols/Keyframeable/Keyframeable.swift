//
//  Keyframeable.swift
//  
//
//  Created by Dominic Go on 12/25/24.
//

import UIKit


public protocol Keyframeable {
  
  associatedtype KeyframeTarget = Self;
  associatedtype KeyframeConfig: BaseKeyframeConfig<KeyframeTarget>;
  
  typealias PropertyAnimatorAnimationBlocks = (
    setup: () throws -> Void,
    applyKeyframe: () -> Void,
    completion: (_ didCancel: Bool) -> Void
  );
    
  func applyKeyframe(_ keyframeConfig: KeyframeConfig) throws;
  
  func createAnimations(
    forKeyframe keyframeConfig: KeyframeConfig,
    withPrevKeyframe keyframeConfigPrev: KeyframeConfig?,
    forPropertyAnimator propertyAnimator: UIViewPropertyAnimator?
  ) throws -> PropertyAnimatorAnimationBlocks;
};

// MARK: - Keyframeable+Default
// ----------------------------

public extension Keyframeable where KeyframeConfig.KeyframeTarget == Self {
  
  func applyKeyframe(_ keyframeConfig: KeyframeConfig) throws {
    try keyframeConfig.apply(toTarget: self);
  };
};
