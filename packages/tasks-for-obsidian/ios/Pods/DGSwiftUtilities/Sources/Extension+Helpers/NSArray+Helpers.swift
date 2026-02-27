//
//  NSArray+Helpers.swift
//  
//
//  Created by Dominic Go on 12/30/24.
//

import Foundation


public extension NSArray {
  
  var asAnyArray: [Any]? {
    self as? Array<Any>;
  };
  
  var asDictArray: [Dictionary<String, Any>]? {
    self.asAnyArray?.asDictValues;
  };
};
