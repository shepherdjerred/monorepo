//
//  KeyframeConfigAnimating.swift
//  
//
//  Created by Dominic Go on 12/27/24.
//

import UIKit


public protocol KeyframeConfigAnimating<KeyframeTarget>: BaseKeyframeConfig {
  
  associatedtype KeyframeTarget;
  
  func createAnimations(
    forTarget keyframeTarget: KeyframeTarget,
    withPrevKeyframe keyframeConfigPrev: Self?,
    forPropertyAnimator propertyAnimator: UIViewPropertyAnimator?
  ) throws -> Keyframeable.PropertyAnimatorAnimationBlocks;
};

public extension KeyframeConfigAnimating {
  
  func createAnimations(
    forTarget keyframeTarget: KeyframeTarget,
    withPrevKeyframe keyframeConfigPrev: Self?,
    forPropertyAnimator propertyAnimator: UIViewPropertyAnimator?
  ) throws -> Keyframeable.PropertyAnimatorAnimationBlocks {
    
    return (
      setup: {
        // no-op
      },
      applyKeyframe: {
        try? self.apply(toTarget: keyframeTarget);
      },
      completion: { _ in
        // no-op
      }
    );
  };
};
