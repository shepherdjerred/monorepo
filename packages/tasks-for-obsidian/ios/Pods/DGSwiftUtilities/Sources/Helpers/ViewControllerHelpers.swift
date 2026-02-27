//
//  ViewControllerHelpers.swift
//  
//
//  Created by Dominic Go on 10/24/23.
//

import UIKit

public class ViewControllerHelpers {

  public static func getRootViewController(
    for window: UIWindow? = nil
  ) -> UIViewController? {
    
    if let window = window {
      return window.rootViewController;
    };
    
    return UIApplication.shared.keyWindow?.rootViewController;
  };
  
  public static func getPresentedViewControllers(
    for window: UIWindow? = nil
  ) -> [UIViewController]? {
    guard let rootVC = Self.getRootViewController(for: window) else {
      return nil;
    };
    
    var presentedVCList: [UIViewController] = [rootVC];
    
    // climb the vc hierarchy to find the topmost presented vc
    while true {
      guard let topVC = presentedVCList.last,
            let presentedVC = topVC.presentedViewController
      else { break };
      
      presentedVCList.append(presentedVC);
    };
    
    return presentedVCList;
  };
  
  public static func getTopmostPresentedViewController(
    for window: UIWindow? = nil
  ) -> UIViewController? {
    guard let presentedVCList = Self.getPresentedViewControllers(for: window)
    else { return nil };
    
    return presentedVCList.last;
  };
};
