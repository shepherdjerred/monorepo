//
//  NSDictionary+Helpers.swift
//  
//
//  Created by Dominic Go on 12/30/24.
//

import Foundation

public extension NSDictionary {
  
  var asAnyDict: [String: Any]? {
    self as? Dictionary<String, Any>;
  };
};
