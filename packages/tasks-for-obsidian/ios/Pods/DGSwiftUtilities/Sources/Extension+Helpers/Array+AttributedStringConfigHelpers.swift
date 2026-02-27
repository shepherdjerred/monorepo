//
//  Array+AttributedStringConfigHelpers.swift
//  ConfigBasedModalExample
//
//  Created by Dominic Go on 6/9/24.
//

import Foundation


public extension Array where Element == AttributedStringConfig {
  
  func makeAttributedString() -> NSMutableAttributedString {
    return self.reduce(into: .init()) {
      let nextAttributedString = $1.makeAttributedString();
      $0.append(nextAttributedString);
    };
  };
};
