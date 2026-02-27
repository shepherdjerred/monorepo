//
//  ClosureInjector.swift
//  ConfigBasedModalExample
//
//  Created by Dominic Go on 6/10/24.
//

import Foundation

public class ClosureInjector {
  public let closure: () -> Void;
  public let handle: String;

  public init(
    attachTo targetObject: any ValueInjectable,
    closure: @escaping () -> Void
  ) {
    self.closure = closure;
    
    let handle = arc4random().description;
    self.handle = handle;
    
    targetObject.injectedValues[handle] = self;
  };

  @objc
  public func invoke() {
    self.closure();
  };
};

