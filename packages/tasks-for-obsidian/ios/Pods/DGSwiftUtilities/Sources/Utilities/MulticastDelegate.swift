//
//  MulticastDelegate.swift
//  
//
//  Created by Dominic Go on 9/2/23.
//

import Foundation

public class MulticastDelegate<T> {
  private let _delegates: NSHashTable<AnyObject> = NSHashTable.weakObjects();
  
  public var delegates: [T] {
    self._delegates.allObjects as! [T];
  };
  
  public var delegateCount: Int {
    self._delegates.allObjects.count;
  };
  
  public init() {
    // no-op
  };
  
  public func add(_ delegate: T) {
    self._delegates.add(delegate as AnyObject);
  };
  
  public func remove(_ delegate: T) {
    self._delegates.remove(delegate as AnyObject);
  };
  
  public func invoke (_ invocation: @escaping (T) -> Void) {
    for delegate in self._delegates.allObjects {
      invocation(delegate as! T)
    };
  };
};
