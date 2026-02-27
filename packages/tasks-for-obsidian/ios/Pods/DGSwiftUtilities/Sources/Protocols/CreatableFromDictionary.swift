//
//  CreatableFromDictionary.swift
//  
//
//  Created by Dominic Go on 4/14/24.
//

import Foundation


public protocol CreatableFromDictionary {
  
  static func create(fromDict dict: Dictionary<String, Any>) throws -> Self;
};
