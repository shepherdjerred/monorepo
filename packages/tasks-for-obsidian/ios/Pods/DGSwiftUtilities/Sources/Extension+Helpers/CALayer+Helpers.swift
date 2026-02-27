//
//  CALayer+Helpers.swift
//  Experiments-Misc
//
//  Created by Dominic Go on 11/12/24.
//

import UIKit


public extension CALayer {

  typealias AnimationWithKey = (
    animationKey: String,
    animation: CAAnimation
  );

  static let commonAnimationKeys: [String] = [
    "bounds.size",
    #keyPath(CALayer.position),
    #keyPath(CALayer.zPosition),
    #keyPath(CALayer.anchorPoint),
    #keyPath(CALayer.anchorPointZ),
    #keyPath(CALayer.transform),
    #keyPath(CALayer.backgroundColor),
    #keyPath(CALayer.opacity),
    #keyPath(CALayer.borderColor),
    #keyPath(CALayer.borderWidth),
    #keyPath(CALayer.cornerRadius),
    #keyPath(CALayer.cornerRadius),
    #keyPath(CALayer.shadowColor),
    #keyPath(CALayer.shadowOffset),
    #keyPath(CALayer.shadowOpacity),
    #keyPath(CALayer.shadowPath),
    #keyPath(CALayer.shadowRadius),
  ];
  
  var animations: [AnimationWithKey] {
  
    let maskAnimations = self.mask?.animations ?? [];
    let animationKeys = self.animationKeys() ?? [];
    
    return animationKeys.reduce(into: maskAnimations) {
      let match = self.animation(
        forKey: $1,
        forType: CAAnimation.self
      );
      
      if let match = match {
        $0.append(($1, match));
      };
    };
  };
  
  var closestBasicAnimation: CABasicAnimation? {
    if let (_, currentAnimation) = self.animations.first,
       let currentAnimation = currentAnimation as? CABasicAnimation
    {
      return currentAnimation;
    };
    
    let childAnimation = self.recursivelyFindChildAnimation(
      forType: CABasicAnimation.self
    );
    
    if let childAnimation = childAnimation {
      return childAnimation;
    };
    
    let parentAnimation = self.recursivelyFindParentAnimation(
      forType: CABasicAnimation.self,
      shouldSkipCurrentLayer: true
    );
    
    if let parentAnimation = parentAnimation {
      return parentAnimation;
    };
    
    return nil;
  };
  
  func animation<T: CAAnimation>(
    forKey key: String,
    forType type: T.Type = T.self
  ) -> T? {
  
    if let animation = self.animation(forKey: key),
       let animation = animation as? T
    {
      return animation;
    };
  
    let action: CAAction? =
         self.delegate?.action?(for: self, forKey: key)
      ?? self.action(forKey: key);
      
    if let animation = action as? T {
      return animation;
    };
    
    return nil;
  };
  
  func recursivelyFindParentAnimation(
    shouldSkipCurrentLayer: Bool = false,
    where predicate: (
      _ animationKey: String,
      _ animation: CAAnimation
    ) -> Bool
  ) -> CAAnimation? {
  
    var currentLayer: CALayer? = shouldSkipCurrentLayer
      ? self.superlayer
      : self;
      
    while currentLayer != nil {
      defer {
        currentLayer = currentLayer!.superlayer;
      };
      
      for (animationKey, animation) in currentLayer!.animations {
        let isMatch = predicate(animationKey, animation);
        
        guard isMatch else {
          continue;
        };
        
        return animation;
      };
    };
    
    return nil;
  };
  
  func recursivelyFindParentAnimation<T: CAAnimation>(
    forType type: T.Type,
    shouldSkipCurrentLayer: Bool = false
  ) -> T? {
    let match = self.recursivelyFindParentAnimation(
      shouldSkipCurrentLayer: shouldSkipCurrentLayer
    ) {
      $1 is T;
    };
    
    guard let match = match else {
      return nil;
    };
    
    return match as? T;
  };
  
  func recursivelyFindParentAnimation<T: CAAnimation>(
    forKeys keys: [String],
    shouldSkipCurrentLayer: Bool = false,
    forType type: T.Type = T.self
  ) -> T? {
  
    var currentLayer: CALayer? = shouldSkipCurrentLayer
      ? self.superlayer
      : self;
    
    while currentLayer != nil {
      defer {
        currentLayer = currentLayer!.superlayer;
      };
      
      for key in keys {
        let match = self.animation(
          forKey: key,
          forType: type
        );
        
        guard let match = match else {
          continue;
        };
        
        return match;
      };
    };
    
    return nil;
  };
  
  func recursivelyFindParentAnimation<T: CAAnimation>(
    forKey key: String,
    shouldSkipCurrentLayer: Bool = false,
    forType type: T.Type = T.self
  ) -> CAAnimation? {
  
    self.recursivelyFindParentAnimation(
      forKeys: [key],
      shouldSkipCurrentLayer: shouldSkipCurrentLayer,
      forType: type
    );
  };
  
  func recursivelyFindChildAnimation(
    shouldSkipCurrentLayer: Bool = false,
    where predicate: (
      _ animationKey: String,
      _ animation: CAAnimation
    ) -> Bool
  ) -> CAAnimation? {
  
    if !shouldSkipCurrentLayer {
      let match = self.animations.first {
        predicate($0.animationKey, $0.animation);
      };
      
      if let match = match {
        return match.animation;
      };
    };
  
    guard let sublayers = self.sublayers else {
      return nil;
    };
    
    for sublayer in sublayers {
      for (animationKey, animation) in sublayer.animations {
        let isMatch = predicate(animationKey, animation);
        
        guard isMatch else {
          continue;
        };
        
        return animation;
      };
      
      let matchFromChild = sublayer.recursivelyFindChildAnimation(
        shouldSkipCurrentLayer: false,
        where: predicate
      );
        
      if let matchFromChild = matchFromChild {
        return matchFromChild;
      };
    };
    
    return nil;
  };
  
  func recursivelyFindChildAnimation<T: CAAnimation>(
    forType type: T.Type,
    shouldSkipCurrentLayer: Bool = false
  ) -> T? {
    let match = self.recursivelyFindChildAnimation {
      $1 is T;
    };
    
    guard let match = match else {
      return nil;
    };
    
    return match as? T;
  };
  
  func recursivelyGetAllChildAnimations(
    shouldSkipCurrentLayer: Bool = false
  ) -> [AnimationWithKey] {
  
    var animations: [AnimationWithKey] = [];
    
    if !shouldSkipCurrentLayer {
      animations += self.animations;
    };
    
    guard let sublayers = self.sublayers else {
      return animations;
    };
    
    for sublayer in sublayers {
      animations += sublayer.recursivelyGetAllChildAnimations(
        shouldSkipCurrentLayer: false
      );
    };
    
    return animations;
  };
  
  func recursivelyGetAllParentAnimations(
    shouldSkipCurrentLayer: Bool = true
  ) -> [AnimationWithKey] {
  
    var animations: [AnimationWithKey] = [];
  
    var currentLayer: CALayer? = shouldSkipCurrentLayer
      ? self.superlayer
      : self;
    
    while currentLayer != nil {
      defer {
        currentLayer = currentLayer!.superlayer;
      };
      
      animations += currentLayer!.animations;
    };
    
    return animations;
  };
};
