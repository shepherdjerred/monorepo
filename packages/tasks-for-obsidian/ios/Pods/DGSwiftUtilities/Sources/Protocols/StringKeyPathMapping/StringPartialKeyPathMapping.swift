//
//  StringPartialKeyPathMapping.swift
//  
//
//  Created by Dominic Go on 12/26/23.
//

import Foundation


public protocol StringPartialKeyPathMapping {
  associatedtype KeyPathRoot = Self;
  
  static var partialKeyPathMap: Dictionary<String, PartialKeyPath<KeyPathRoot>> { get };
};
