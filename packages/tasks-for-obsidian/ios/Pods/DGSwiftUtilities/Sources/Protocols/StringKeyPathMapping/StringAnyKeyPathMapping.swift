//
//  StringAnyKeyPathMapping.swift
//  
//
//  Created by Dominic Go on 12/26/23.
//

import Foundation

/// type erased version of `StringPartialKeyPathMapping`
public protocol StringAnyKeyPathMapping {

  static var anyKeyPathMap: Dictionary<String, AnyKeyPath> { get };
};
