//
//  AnyArray+Helpers.swift
//  
//
//  Created by Dominic Go on 12/30/24.
//

import Foundation


public extension Array where Element == Any {

  var asDictValues: [Dictionary<String, Any>] {
    self.compactMap {
      switch $0 {
        case let dict as Dictionary<String, Any>:
          return dict;
          
        case let objcDict as NSDictionary:
          return objcDict as? Dictionary<String, Any>;
      
        default:
          return nil;
      };
    };
  };
};
