//
//  BaseKeyframeConfig.swift
//  
//
//  Created by Dominic Go on 12/26/24.
//

import UIKit


public protocol BaseKeyframeConfig<KeyframeTarget> {

  associatedtype KeyframeTarget;

  func apply(toTarget target: KeyframeTarget) throws;
};

// MARK: - BaseKeyframeConfig+Default
// ----------------------------------

public extension BaseKeyframeConfig {
  
  func apply(
    toTarget target: KeyframeTarget
  ) throws where KeyframeTarget: UIView {
  
    self.applyBaseKeyframe(toView: target);
  };
};

// MARK: - BaseKeyframeConfig+Helpers
// ------------------------------

public extension BaseKeyframeConfig {
  
  func applyBaseKeyframe(
    toView targetView: KeyframeTarget
  ) where KeyframeTarget: UIView {
  
    if let baseViewKeyframe = self as? (any BaseViewKeyframeConfig) {
      baseViewKeyframe.applyBaseViewKeyframe(toView: targetView);
    };
    
    if let baseLayerKeyframe = self as? (any BaseLayerKeyframeConfig) {
      baseLayerKeyframe.applyBaseLayerKeyframe(toView: targetView);
    };
  };
};
