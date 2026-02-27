//
//  UIViewAnimationCurve+Helpers.swift
//  
//
//  Created by Dominic Go on 12/13/24.
//

import UIKit

public extension UIView.AnimationCurve {
  
  var asAnimationOptions: UIView.AnimationOptions {
    switch self {
      case .easeInOut:
        return [.curveEaseInOut];
        
      case .easeIn:
        return [.curveEaseIn];
        
      case .easeOut:
        return [.curveEaseOut];
        
      case .linear:
        return [.curveLinear];
        
      @unknown default:
        return [];
    };
  };
};
