//
//  Array+ComparableHelpers.swift
//  
//
//  Created by Dominic Go on 7/10/24.
//

import Foundation


public extension Array where Element: Comparable  {
  
  var indexedMin: IndexElementPair? {
    self.enumerated().reduce(into: nil) {
      guard let current = $0 else {
        $0 = ($1.offset, $1.element);
        return;
      };
      
      if current.value.isLessThan(to: $1.element) {
        $0 = ($1.offset, $1.element);
      };
    };
  };
  
  var indexedMax: IndexElementPair? {
    self.enumerated().reduce(into: nil) {
      guard let current = $0 else {
        $0 = ($1.offset, $1.element);
        return;
      };
      
      if current.value.isGreaterThan(to: $1.element) {
        $0 = ($1.offset, $1.element);
      };
    };
  };
};

