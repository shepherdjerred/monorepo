//
//  BaseLayerKeyframeConfig.swift
//  
//
//  Created by Dominic Go on 12/25/24.
//

import UIKit


public protocol BaseLayerKeyframeConfig<KeyframeTarget>: BaseKeyframeConfig where KeyframeTarget: UIView {
  
  associatedtype KeyframeTarget;
  
  var borderWidth: CGFloat? { get set };
  var borderColor: UIColor? { get set };
  
  var shadowColor: UIColor? { get set };
  var shadowOffset: CGSize? { get set };
  var shadowOpacity: CGFloat? { get set };
  var shadowRadius: CGFloat? { get set };
  
  var cornerRadius: CGFloat? { get set };
  var cornerMask: CACornerMask? { get set };
  
  func applyBaseLayerKeyframe(toTarget targetView: KeyframeTarget);
};

// MARK: - BaseLayerKeyframeConfig+Default
// ---------------------------------------

public extension BaseLayerKeyframeConfig {
  
  func applyBaseLayerKeyframe(toTarget targetView: KeyframeTarget) {
    self.applyBaseLayerKeyframe(toLayer: targetView.layer);
  };
};

// MARK: - BaseLayerKeyframeConfig+Helpers
// ---------------------------------------

public extension BaseLayerKeyframeConfig {
  
  func applyBaseLayerKeyframe(toLayer layer: CALayer) {
    if let borderWidth = self.borderWidth {
      layer.borderWidth = borderWidth;
    };
    
    layer.borderColor = self.borderColor?.cgColor;
    layer.shadowColor = self.shadowColor?.cgColor
    
    if let shadowOffset = self.shadowOffset {
      layer.shadowOffset = shadowOffset;
    };
    
    if let shadowOpacity = self.shadowOpacity {
      layer.shadowOpacity = .init(shadowOpacity);
    };
    
    if let shadowRadius = self.shadowRadius {
      layer.shadowRadius = shadowRadius;
    };
    
    if let cornerRadius = self.cornerRadius {
      layer.cornerRadius = cornerRadius;
    };
    
    if let cornerMask = self.cornerMask {
      layer.maskedCorners = cornerMask;
    };
  };

  func applyBaseLayerKeyframe(toView view: UIView) {
    self.applyBaseLayerKeyframe(toLayer: view.layer);
  };
  
  // MARK: - Chain Setter Methods
  // ----------------------------
  
  mutating func withBorderWidth(_ borderWidth: CGFloat) {
    self.borderWidth = self.borderWidth;
  };
  
  mutating func withBorderColor(_ borderColor: UIColor) {
    self.borderColor = self.borderColor;
  };
  
  mutating func withShadowColor(_ shadowColor: UIColor) {
    self.shadowColor = self.shadowColor;
  };
  
  mutating func withShadowOffset(_ shadowOffset: CGSize) {
    self.shadowOffset = self.shadowOffset;
  };
  
  mutating func withShadowOpacity(_ shadowOpacity: CGFloat) {
    self.shadowOpacity = self.shadowOpacity;
  };
  
  mutating func withShadowRadius(_ shadowRadius: CGFloat) {
    self.shadowRadius = self.shadowRadius;
  };
  
  mutating func withCornerRadius(_ cornerRadius: CGFloat) {
    self.cornerRadius = self.cornerRadius;
  };
  
  mutating func withCornerMask(_ cornerMask: CACornerMask) {
    self.cornerMask = self.cornerMask;
  };
};
