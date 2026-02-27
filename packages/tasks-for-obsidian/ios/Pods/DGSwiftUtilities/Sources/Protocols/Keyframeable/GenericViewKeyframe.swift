//
//  GenericViewKeyframe.swift
//  
//
//  Created by Dominic Go on 12/28/24.
//

import UIKit


public struct GenericViewKeyframe<T: UIView>:
  BaseViewKeyframeConfig,
  BaseLayerKeyframeConfig,
  KeyframeConfigAnimating
{
  public typealias KeyframeTarget = T;

  public var opacity: CGFloat?;
  public var backgroundColor: UIColor?;
  public var transform: Transform3D?;
  
  public var borderWidth: CGFloat?;
  public var borderColor: UIColor?;
  public var shadowColor: UIColor?;
  public var shadowOffset: CGSize?;
  public var shadowOpacity: CGFloat?;
  public var shadowRadius: CGFloat?;
  public var cornerRadius: CGFloat?;
  public var cornerMask: CACornerMask?;
  
  public init(
    opacity: CGFloat? = nil,
    backgroundColor: UIColor? = nil,
    transform: Transform3D? = nil,
    borderWidth: CGFloat? = nil,
    borderColor: UIColor? = nil,
    shadowColor: UIColor? = nil,
    shadowOffset: CGSize? = nil,
    shadowOpacity: CGFloat? = nil,
    shadowRadius: CGFloat? = nil,
    cornerRadius: CGFloat? = nil,
    cornerMask: CACornerMask? = nil
  ) {
    self.opacity = opacity
    self.backgroundColor = backgroundColor
    self.transform = transform
    self.borderWidth = borderWidth
    self.borderColor = borderColor
    self.shadowColor = shadowColor
    self.shadowOffset = shadowOffset
    self.shadowOpacity = shadowOpacity
    self.shadowRadius = shadowRadius
    self.cornerRadius = cornerRadius
    self.cornerMask = cornerMask
  };
};
