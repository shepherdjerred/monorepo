//
//  FauxDictionary.swift
//  react-native-ios-utilities
//
//  Created by Dominic Go on 5/25/24.
//

import Foundation


public struct FauxDictionary<K: Hashable, T> {

  public typealias SetterBlock =  (_ key: K, _ value: T?) -> Void;
  
  public typealias GetterBlock = (_ key: K) -> T?;

  public var setterBlock: SetterBlock;
  public var getterBlock: GetterBlock;

  public init(
    setter setterBlock: @escaping SetterBlock,
    getter getterBlock: @escaping GetterBlock
  ) {
    self.setterBlock = setterBlock;
    self.getterBlock = getterBlock;
  };
  
  public subscript(key: K) -> T? {
    get {
      self.getterBlock(key);
    }
    set {
      self.setterBlock(key, newValue);
    }
  };
};
