//
//  MappedMulticastDelegate.swift
//  react-native-ios-utilities
//
//  Created by Dominic Go on 5/25/24.
//

import Foundation

public class MappedMulticastDelegate<K: Hashable, T> {
  private var _delegateMap: WeakDictionary<K, T> = .init();
  
  public var allDelegates: [T] {
    self._delegateMap.dict.values.compactMap {
      $0.ref;
    };
  };
  
  public var delegateCount: Int {
    self.allDelegates.count;
  };
  
  public init() {
    // no-op
  };
  
  public func get(forKey key: K) -> T? {
    return self._delegateMap[key];
  };
  
  public func add(forKey key: K, withDelegate delegate: T) {
    self._delegateMap[key] = delegate;
  };
  
  public func remove(delegate: T) {
    let objectDelegate = delegate as AnyObject;
    
    let match = self._delegateMap.dict.first {
      $0.value === objectDelegate;
    };
    
    guard let match = match else { return };
    self._delegateMap.removeValue(for: match.key);
  };
  
  public func remove(forKey key: K){
    self._delegateMap.removeValue(for: key);
  };
  
  public func invokeAll(_ invocation: @escaping (T) -> Void) {
    for delegate in self.allDelegates {
      invocation(delegate);
    };
  };
  
  public func invoke(forKey key: K, _ invocation: @escaping (T) -> Void){
    guard let match = self[key] else { return };
    invocation(match);
  };
  
  public subscript(key: K) -> T? {
    get {
      self.get(forKey: key);
    }
    set {
      guard let ref = newValue else { return };
      self.add(forKey: key, withDelegate: ref);
    }
  }
};
