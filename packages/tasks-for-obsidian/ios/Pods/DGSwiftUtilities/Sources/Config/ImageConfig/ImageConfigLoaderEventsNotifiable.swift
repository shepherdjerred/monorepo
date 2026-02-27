//
//  ImageConfigLoaderEventsNotifiable.swift
//  
//
//  Created by Dominic Go on 8/7/24.
//

import Foundation


public protocol ImageConfigLoaderEventsNotifiable: AnyObject {
  
  /// Note: Will be invoked in the main thread
  func notifyOnImageWillLoad(sender: ImageConfigLoader);
  
  /// Note: Will be invoked in the main thread
  func notifyOnImageDidLoad(sender: ImageConfigLoader);
};
