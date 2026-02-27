//
//  ViewPropertyAnimatorWrapper.swift
//  
//
//  Created by Dominic Go on 8/15/24.
//

import UIKit

public class ViewPropertyAnimatorWrapper {

  // MARK: - Properties
  // ------------------
  
  public var animator: UIViewPropertyAnimator;
  private weak var targetView: UIView?;
  
  // MARK: - Init
  // ------------
  
  public init<T: UIView>(
    forView targetView: T,
    animationBlock: @escaping (_ view: T) -> Void
  ) {
    self.targetView = targetView;
    
    let animator = UIViewPropertyAnimator(
      duration: 0,
      curve: .linear
    );
    
    animator.addAnimations {
      animationBlock(targetView);
    };
    
    self.animator = animator;
  };
  
  // MARK: - Functions
  // -----------------
  
  public func setFractionComplete(forPercent percent: CGFloat) {
    guard self.animator.fractionComplete != percent else { return };
    self.animator.fractionComplete = percent;
  };
  
  public func clear(){
    self.animator.stopAnimation(true);
  };
};
