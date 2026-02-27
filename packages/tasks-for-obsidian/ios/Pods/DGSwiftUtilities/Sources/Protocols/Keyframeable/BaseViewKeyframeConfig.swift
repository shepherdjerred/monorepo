//
//  BaseViewKeyframeConfig.swift
//  
//
//  Created by Dominic Go on 12/25/24.
//

import UIKit


public protocol BaseViewKeyframeConfig<KeyframeTarget>: BaseKeyframeConfig where KeyframeTarget: UIView {
  
  associatedtype KeyframeTarget;

  var opacity: CGFloat? { get set };
  var transform: Transform3D? { get set };
  var backgroundColor: UIColor? { get set };
  
  func applyBaseViewKeyframe(toTarget targetView: KeyframeTarget);
};

// MARK: - BaseViewKeyframeConfig+Default
// --------------------------------------

public extension BaseViewKeyframeConfig {
  
  func applyBaseViewKeyframe(toTarget targetView: KeyframeTarget) {
    self.applyBaseViewKeyframe(toView: targetView);
  };
};

// MARK: - BaseViewKeyframeConfig+Helpers
// --------------------------------------

public extension BaseViewKeyframeConfig {
  
  func applyBaseViewKeyframe(toView view: UIView) {
    if let opacity = self.opacity {
      view.alpha = opacity;
    };
    
    if let transform = self.transform {
      view.layer.transform = transform.transform3D;
    };
    
    view.backgroundColor = self.backgroundColor;
  };
  
  // MARK: - Chain Setter Methods
  // ----------------------------
  
  mutating func withOpacity(_ opacity: CGFloat) {
    self.opacity = opacity;
  };
  
  mutating func withTransform(_ transform: Transform3D) {
    self.transform = transform;
  };
  
  mutating func withBackgroundColor(_ backgroundColor: UIColor) {
    self.backgroundColor = backgroundColor;
  };
};



