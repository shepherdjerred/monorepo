//
//  KeyframeableViaConfig.swift
//  
//
//  Created by Dominic Go on 12/27/24.
//

import UIKit


public protocol KeyframeableViaConfig: Keyframeable
  where KeyframeConfig: KeyframeConfigAnimating<KeyframeTarget>
{
  
  associatedtype KeyframeTarget = Self;
};


// MARK: - KeyframeableViaConfig+Default
// ----------------------------------

public extension KeyframeableViaConfig where KeyframeConfig.KeyframeTarget == Self {
  
  func createAnimations(
    forKeyframe keyframeConfig: KeyframeConfig,
    withPrevKeyframe keyframeConfigPrev: KeyframeConfig?,
    forPropertyAnimator propertyAnimator: UIViewPropertyAnimator?
  ) throws -> PropertyAnimatorAnimationBlocks {
  
    let animationBlocks = try keyframeConfig.createAnimations(
      forTarget: self,
      withPrevKeyframe: keyframeConfigPrev,
      forPropertyAnimator: propertyAnimator
    );
    
    return (
      setup: {
        try animationBlocks.setup();
      },
      applyKeyframe: {
        animationBlocks.applyKeyframe();
      },
      completion: {
        animationBlocks.completion($0);
      }
    );
  };
};
