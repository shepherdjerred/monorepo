//
//  UIGestureRecognizerState+Helpers.swift
//
//
//  Created by Dominic Go on 6/16/24.
//

import UIKit


public extension UIGestureRecognizer.State {
  var isActive: Bool {
    switch self {
      case .began, .changed:
        return true;
        
      default:
        return false;
    }
  };
};
