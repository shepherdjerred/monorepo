//
//  StringComparisonMode.swift
//  
//
//  Created by Dominic Go on 12/19/23.
//

import Foundation

public enum StringComparisonMode: String, CaseIterable {
  case contains, matches;
  
  public func evaluate(a: String, b: String, isCaseSensitive: Bool) -> Bool {
    let stringA = isCaseSensitive
     ? a
     : a.lowercased();
     
    let stringB = isCaseSensitive
     ? b
     : b.lowercased();
     
     switch self {
       case .contains: return stringA.contains(stringB)
       case .matches : return stringA == stringB;
     };
  };
};
