//
//  SelectorProxy.swift
//  DGSwiftUtilities
//
//  Created by Dominic Go on 7/26/25.
//

import Foundation

public class SelectorProxy<T: AnyObject>: NSObject {
  
  public typealias InvocationBlock = (
    _ context: (
      target: T,
      self: SelectorProxy<T>
    )
  ) -> Void;

  public weak var target: T?;
  public var block: InvocationBlock?

  public init(target: T, block: InvocationBlock?) {
    self.target = target;
    self.block = block;
    super.init()
  };

  @objc
  public func invokeBlock() {
    guard let target = self.target else {
      return;
    };
    
    self.block?((target, self));
  }
};
