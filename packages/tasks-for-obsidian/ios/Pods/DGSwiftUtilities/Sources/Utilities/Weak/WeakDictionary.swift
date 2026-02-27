//
//  RNIWeakDictionary.swift
//  react-native-ios-modal
//
//  Created by Dominic Go on 3/15/23.
//

import UIKit


public class WeakDictionary<K: Hashable, T> {
  
  public var rawDict: [K: WeakRef<T>] = [:];
  
  public var purgedDict: [K: WeakRef<T>] {
    get {
      self.rawDict.compactMapValues {
        $0.rawRef != nil ? $0 : nil;
      }
    }
  };
  
  public var dict: [K: WeakRef<T>] {
    get {
      let purgedDict = self.purgedDict;
      self.rawDict = purgedDict;
      
      return purgedDict;
    }
  }
  
  public init(){
    // no-op
  };
  
  public func set(for key: K, with value: T){
    self.rawDict[key] = WeakRef(with: value);
  };
  
  public func get(for key: K) -> T? {
    guard let ref = self.rawDict[key]?.ref else {
      self.rawDict.removeValue(forKey: key);
      return nil;
    };
    
    return ref;
  };
  
  public func removeValue(for key: K){
    self.rawDict.removeValue(forKey: key);
  };
  
  public subscript(key: K) -> T? {
    get {
      self.get(for: key);
    }
    set {
      guard let ref = newValue else { return };
      self.set(for: key, with: ref);
    }
  }
};

