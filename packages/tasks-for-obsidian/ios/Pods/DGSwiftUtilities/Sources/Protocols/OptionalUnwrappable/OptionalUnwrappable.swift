//
//  OptionalUnwrappable.swift
//  
//
//  Created by Dominic Go on 11/29/23.
//

import Foundation

public protocol OptionalUnwrappable {
  func isSome() -> Bool;
  func unwrap() -> Any;
}
