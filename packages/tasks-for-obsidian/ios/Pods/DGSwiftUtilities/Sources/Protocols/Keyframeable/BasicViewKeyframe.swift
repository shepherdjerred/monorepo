//
//  BasicViewKeyframe.swift
//  
//
//  Created by Dominic Go on 12/26/24.
//

import UIKit


public struct BasicViewKeyframe<T: UIView>:
  BaseViewKeyframeConfig,
  KeyframeConfigAnimating
{
  public typealias KeyframeTarget = T;

  public var opacity: CGFloat?;
  public var backgroundColor: UIColor?;
  public var transform: Transform3D?;
  
  public init(
    opacity: CGFloat? = nil,
    backgroundColor: UIColor? = nil,
    transform: Transform3D? = nil
  ) {
    self.opacity = opacity;
    self.backgroundColor = backgroundColor;
    self.transform = transform;
  };
};
