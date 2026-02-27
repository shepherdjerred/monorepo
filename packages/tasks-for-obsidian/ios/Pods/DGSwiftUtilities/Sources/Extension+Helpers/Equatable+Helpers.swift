//
//  Equatable+Helpers.swift
//  
//
//  Created by Dominic Go on 7/6/24.
//

import Foundation

public extension Equatable {
  func isEqual<T: Equatable>(to other: T) -> Bool {
    guard let _self = self as? T else {
      return false;
    };

    return _self == other;
  };
};
