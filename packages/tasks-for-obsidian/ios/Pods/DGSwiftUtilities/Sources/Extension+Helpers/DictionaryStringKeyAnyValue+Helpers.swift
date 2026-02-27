//
//  DictionaryStringKeyAnyValue+Helpers.swift
//  
//
//  Created by Dominic Go on 7/6/24.
//

import Foundation

public extension Dictionary where Key == String, Value == Any {
  
  static func ==(lhs: Self, rhs: Self) -> Bool {
    if lhs.isEmpty && rhs.isEmpty {
      return true;
    };
  
    let isKeyCountEqual = lhs.keys.count == rhs.keys.count;
    if !isKeyCountEqual {
      return false;
    };
    
    let isAllKeysEqual = lhs.keys.allSatisfy {
      return rhs.keys.contains($0);
    };
    
    if !isAllKeysEqual {
      return false;
    };
    
    return lhs.keys.allSatisfy {
      switch(lhs[$0], rhs[$0]){
        case (.none, .none):
          fallthrough;
          
        case (.some, .none):
          return false;
          
        case (.none, .some):
          return false;
          
        case let (lhsValue as AnyHashable, rhsValue as AnyHashable):
          let isMatch = lhsValue == rhsValue;
          if(!isMatch){
            return false;
          };
          
        case let (lhsValue as any Equatable, rhsValue as any Equatable):
          let isMatch = lhsValue.isEqual(to: rhsValue);
          if(!isMatch){
            return false;
          };

        case let (lhsValue, rhsValue):
          let isMatch = type(of: lhsValue) == type(of: rhsValue);
          if !isMatch {
            return false;
          };
      };
      
      return true;
    };
  };
  
  static func !=(lhs: Self, rhs: Self) -> Bool {
    !(lhs == rhs);
  };
};
