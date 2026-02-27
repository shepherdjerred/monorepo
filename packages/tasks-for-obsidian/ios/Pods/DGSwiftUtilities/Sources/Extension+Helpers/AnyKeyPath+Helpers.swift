//
//  AnyKeyPath+Helpers.swift
//  react-native-ios-utilities
//
//  Created by Dominic Go on 5/24/24.
//

import Foundation

public extension AnyKeyPath {
  var rootTypeAsString: String {
    return "\(type(of: Self.rootType))";
  };

  var valueTypeAsString: String {
    return "\(type(of: Self.valueType))";
  };
  
  var rootTypeAsType: Any.Type {
    return Self.rootType.self;
  };
  
  var valueTypeAsType: Any.Type {
    return Self.valueType.self;
  };
};
