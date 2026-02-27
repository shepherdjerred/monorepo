//
//  BaseFrameLayoutKeyframe.swift
//  
//
//  Created by Dominic Go on 12/26/24.
//

import UIKit


// TODO: WIP for `AdaptiveModal`
// to be impl. (stub/placeholder for now)

public protocol BaseFrameLayoutKeyframe: BaseKeyframeConfig where KeyframeTarget == UIView {
  
  var frame: CGRect { get };
  var contentPadding: UIEdgeInsets { get };

  func applyBaseLayoutKeyframe(toTargetView targetView: KeyframeTarget);
};

// MARK: - BaseFrameLayoutKeyframe+Default
// --------------------------------------

public extension BaseFrameLayoutKeyframe {
  
  @discardableResult
  func applyBaseLayoutKeyframe(
    toTargetView targetView: KeyframeTarget,
    constraintTarget: UIView? = nil,
    constraintLeft: NSLayoutConstraint?,
    constraintRight: NSLayoutConstraint?,
    constraintTop: NSLayoutConstraint?,
    constraintBottom: NSLayoutConstraint?
  ) -> (
    didChangeFrame: Bool,
    didChangeConstraints: Bool
  ) {
  
    self.applyBaseLayoutKeyframe(
      toView: targetView,
      constraintLeft: constraintLeft,
      constraintRight: constraintRight,
      constraintTop: constraintTop,
      constraintBottom: constraintBottom
    );
  };
};

// MARK: - BaseFrameLayoutKeyframe+Helpers
// --------------------------------------

public extension BaseFrameLayoutKeyframe {

  var contentPaddingAdjusted: UIEdgeInsets {
    .init(
      top   :  self.contentPadding.top,
      left  :  self.contentPadding.left,
      bottom: -self.contentPadding.bottom,
      right : -self.contentPadding.right
    );
  };
  
  @discardableResult
  func applyBaseLayoutKeyframe(
    toView view: UIView,
    constraintLeft: NSLayoutConstraint?,
    constraintRight: NSLayoutConstraint?,
    constraintTop: NSLayoutConstraint?,
    constraintBottom: NSLayoutConstraint?
  ) -> (
    didChangeFrame: Bool,
    didChangeConstraints: Bool
  ) {
  
    let didChangeFrame = view.frame != self.frame;
    view.frame = self.frame;
    
    let padding = self.contentPaddingAdjusted;
    var didChangeConstraints = false;
    
    if let constraintLeft = constraintLeft,
       constraintLeft.constant != padding.left
    {
      constraintLeft.constant = padding.left;
      didChangeConstraints = true;
    };
    
    if let constraintRight = constraintRight,
       constraintRight.constant != padding.right
    {
      constraintRight.constant = padding.right;
      didChangeConstraints = true;
    };
    
    if let constraintTop = constraintTop,
       constraintTop.constant != padding.top
    {
      constraintTop.constant = padding.top;
      didChangeConstraints = true;
    };
    
    if let constraintBottom = constraintBottom,
       constraintBottom.constant != padding.bottom
    {
      constraintBottom.constant = padding.bottom;
      didChangeConstraints = true;
    };
    
    return (didChangeFrame, didChangeConstraints);
  };
};
