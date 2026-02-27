//
//  InitializableFromDictionary+Deprecated.swift
//  
//
//  Created by Dominic Go on 7/24/24.
//

import Foundation


public extension InitializableFromDictionary {
  
  // For backwards compatibility
  @available(*, deprecated, message: "Please use init(fromDict:) instead...")
  init?(dict: Dictionary<String, Any>){
    guard let value = try? Self.init(fromDict: dict) else { return nil };
    self = value;
  };
};
