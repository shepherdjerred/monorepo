//
//  StringPartialKeyPathMapping+StringAnyKeyPathMapping.swift
//  
//
//  Created by Dominic Go on 12/27/23.
//

import Foundation


extension StringPartialKeyPathMapping where Self: StringAnyKeyPathMapping {
  
  public static var anyKeyPathMap: Dictionary<String, AnyKeyPath> {
    Self.partialKeyPathMap as Dictionary<String, AnyKeyPath>;
  };
};
