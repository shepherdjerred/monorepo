//
//  Optional+OptionalUnwrappable.swift
//  
//
//  Created by Dominic Go on 8/7/23.
//

import Foundation


extension Optional: OptionalUnwrappable {

  public func isSome() -> Bool {
    switch self {
      case .none: return false;
      case .some: return true;
    };
  };

  public func unwrap() -> Any {
    switch self {
      case .none:
        preconditionFailure("trying to unwrap nil");
        
      case let .some(value):
        return value;
    };
  };
};
