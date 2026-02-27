//
//  UIApplication+Helpers.swift
//  
//
//  Created by Dominic Go on 9/27/23.
//

import UIKit


extension UIApplication {

  public var allWindows: [UIWindow] {
    var windows: [UIWindow] = [];
    
    #if swift(>=5.5)
    // Version: Swift 5.5 and newer - iOS 15 and newer
    guard #available(iOS 13.0, *) else {
      return UIApplication.shared.windows;
    };
    
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue };
      windows += windowScene.windows;
    };
    
    #elseif swift(>=5)
    // Version: Swift 5.4 and below - iOS 14.5 and below
    // Note: 'windows' was deprecated in iOS 15.0+
    
    // first element is the "key window"
    if let keyWindow =
        UIApplication.shared.windows.first(where: { $0.isKeyWindow }) {
      
      windows.append(keyWindow);
    };
    
    UIApplication.shared.windows.forEach {
      // skip if already added
      guard !windows.contains($0) else { return };
      windows.append($0);
    };

    #elseif swift(>=4)
    // Version: Swift 4 and below - iOS 12.4 and below
    // Note: `keyWindow` was deprecated in iOS 13.0+
    
    // first element is the "key window"
    if let keyWindow = UIApplication.shared.keyWindow {
      windows.append(keyWindow);
    };
    
    UIApplication.shared.windows.forEach {
      // skip if already added
      guard !windows.contains($0) else { return };
      windows.append($0);
    };
    
    #else
    // Version: Swift 3.1 and below - iOS 10.3 and below
    // Note: 'sharedApplication' has been renamed to 'shared'
    guard let appDelegate =
            UIApplication.sharedApplication().delegate as? AppDelegate,
          
          let window = appDelegate.window
    else { return [] };
    
    return windows.append(window);
    #endif
    
    return windows;
  };
  
  public var activeWindow: UIWindow? {
    guard #available(iOS 13.0, *) else {
      // Using iOS 12 and below
      return UIApplication.shared.windows.first;
    };
    
    // Get connected scenes
    return self.connectedScenes
      // Keep only active scenes, onscreen and visible to the user
      .filter { $0.activationState == .foregroundActive }
      
      // Keep only the first `UIWindowScene`
      .first(where: { $0 is UIWindowScene })
      
      // Get its associated windows
      .flatMap({ $0 as? UIWindowScene })?.windows
      
      // Finally, keep only the key window
      .first(where: \.isKeyWindow);
  };
  
  // alias
  public var keyWindow: UIWindow? {
    self.activeWindow;
  };

  public var presentedViewControllerForKeyWindow: UIViewController? {
    var topVC = self.keyWindow?.rootViewController;

    // If root `UIViewController` is a `UITabBarController`
    if let presentedController = topVC as? UITabBarController {
      // Move to selected `UIViewController`
      topVC = presentedController.selectedViewController;
    };
      
    // Go deeper to find the last presented `UIViewController`
    while let presentedController = topVC?.presentedViewController {
      // If root `UIViewController` is a `UITabBarController`
      if let presentedController = presentedController as? UITabBarController {
        // Move to selected `UIViewController`
        topVC = presentedController.selectedViewController;
        
      } else {
        // Otherwise, go deeper
        topVC = presentedController;
      };
    };
    
    return topVC;
  };
};
