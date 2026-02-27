//
//  Array+Helpers.swift
//  
//
//  Created by Dominic Go on 6/16/24.
//

import Foundation

public typealias IndexValuePair<T> = (index: Int, value: T);

public extension Array {

  /// Kind of like a type-erased version of `Enumerated`
  typealias IndexElementPair = IndexValuePair<Element>;

  subscript(cyclicIndex index: Index) -> Element {
    get {
      self[self.index(forCyclicIndex: index)];
    }
    set {
      self[self.index(forCyclicIndex: index)] = newValue;
    }
  }

  var nilIfEmpty: Self? {
    self.count > 0 ? self : nil;
  };
  
  func index(forCyclicIndex cyclicIndex: Index) -> Index {
    if cyclicIndex >= 0 {
      return cyclicIndex % self.count;
    };
    
    let rawIndex = (cyclicIndex % self.count);
    let indexReversed = rawIndex + self.count;
    
    return indexReversed % self.count;
  };
  
  func first<T>(whereType type: T.Type) -> T? {
    let match = self.first {
      $0 is T;
    };
    
    return match as? T;
  };
  
  func extractValues<U>(
    forKey key: KeyPath<Element, U>
  ) -> [U] {
    self.map {
      $0[keyPath: key];
    };
  };

  func indexedFirst(
    where predicate: (_ index: Index, _ value: Element) -> Bool
  ) -> IndexElementPair? {
    let match = self.enumerated().first {
      predicate($0.offset, $0.element);
    };
    
    guard let match = match else {
      return nil;
    };
    
    return (match.offset, match.element);
  };
  

  /// Reverse search, starting from last -> first
  /// Returns element that matches `predicate`
  ///
  func indexedLast(
    where predicate: (_ index: Index, _ value: Element) -> Bool
  ) -> IndexElementPair? {
    let match = self.enumerated().reversed().first {
      predicate($0.offset, $0.element);
    };
    
    guard let match = match else {
      return nil;
    };
    
    return (match.offset, match.element);
  };
  
  mutating func unwrapThenAppend(_ element: Element?) {
    guard let element = element else { return };
    self.append(element);
  };
  
  /// Create a new array containing a specific number of elements from the 
  /// beginning of the original array. 
  ///
  /// Ensures that the requested count doesn't exceed the array's length.
  ///
  /// - Parameter count: 
  ///   The number of elements to include in the new array.
  ///
  /// - Returns: 
  ///   A new array containing the specified number of elements from the 
  ///   beginning of the original array.
  ///
  /// **Note:** 
  /// If `count` is greater than the array's length, the entire array is 
  /// returned.
  ///
  /// If `count` is negative, an empty array is returned.
  ///
  func prefixCopy(count: Int) -> Self {
    let countAdj = count.clamped(min: 0, max: self.count);
    let slice = self.prefix(countAdj);
    
    return .init(slice);
  };
  
  /// Creates a new array containing the specified number of elements from the 
  /// end of the original array.
  ///
  /// - Parameter count: 
  ///   The number of elements to include in the new array.
  ///
  /// - Returns: 
  ///   A new array containing the specified number of elements from the end of 
  ///   the original array.
  ///
  /// **Note:** 
  /// If `count` is greater than the array's length, the entire array is 
  /// returned.
  ///
  /// If `count` is negative, an empty array is returned.
  ///
  func suffixCopy(count: Int) -> Self {
    let countAdj = count.clamped(min: 0, max: self.count);
    let slice = self.suffix(countAdj);
    
    return .init(slice);
  };
};
