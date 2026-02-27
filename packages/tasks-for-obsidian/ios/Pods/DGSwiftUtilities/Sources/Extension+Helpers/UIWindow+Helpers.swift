//
//  UIWindow+Helpers.swift
//  
//
//  Created by Dominic Go on 11/29/23.
//

import UIKit

public extension UIWindow {
  
  /// Recursively calls `presentedViewController` starting from the root
  /// controller
  ///
  var topmostPresentedViewController: UIViewController? {
    guard let rootViewController = self.rootViewController else { return nil };
    
    var currentVC = rootViewController;
    
    while let nextVC = currentVC.presentedViewController {
      currentVC = nextVC;
    };
    
    return currentVC;
  };
};
