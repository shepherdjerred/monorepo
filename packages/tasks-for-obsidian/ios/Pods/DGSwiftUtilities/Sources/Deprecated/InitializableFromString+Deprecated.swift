//
//  InitializableFromString+Deprecated.swift
//  
//
//  Created by Dominic Go on 7/24/24.
//

import Foundation


public extension InitializableFromString {
  
  // For backwards compatibility
  @available(*, deprecated, message: "Please use init(fromString:) instead...")
  init?(string: String){
    guard let value = try? Self.init(fromString: string) else { return nil };
    self = value;
  };
};
