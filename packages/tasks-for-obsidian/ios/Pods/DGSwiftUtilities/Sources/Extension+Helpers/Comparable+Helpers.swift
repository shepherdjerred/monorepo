//
//  Comparable+Helpers.swift
//  
//
//  Created by Dominic Go on 7/10/24.
//

import Foundation

public extension Comparable where Self: BinaryInteger { 
  
  static func < <T: BinaryInteger>(lhs: Self, rhs: T) -> Bool {
    return lhs < Self(rhs);
  };
  
  static func < <T: BinaryFloatingPoint>(lhs: Self, rhs: T) -> Bool {
    return lhs < Self(rhs);
  };
};

public extension Comparable where Self: BinaryFloatingPoint { 
  
  static func < <T: BinaryInteger>(lhs: Self, rhs: T) -> Bool {
    return lhs < Self(rhs);
  };
  
  static func < <T: BinaryFloatingPoint>(lhs: Self, rhs: T) -> Bool {
    return lhs < Self(rhs);
  };
};

public extension Comparable {
  static func < <T: Comparable>(lhs: Self, rhs: T) -> Bool {
    if let lhs = lhs as? T {
      return lhs < rhs;
    };
    
    #if DEBUG
    print(
      "Comparable - Warning implicit comparison failure",
      "\n - will begin implicit casting...",
      "\n - lhs: \(lhs), \(type(of: lhs))",
      "\n - rhs: \(rhs), \(type(of: rhs))",
      "\n"
    );
    #endif
    
    switch (lhs, rhs) {
      case let (
        lhsFloat as any BinaryFloatingPoint,
        rhsFloat as any BinaryFloatingPoint
      ):
        return Double(lhsFloat) < rhsFloat;
        
      case let (
        lhsInt as any BinaryInteger,
        rhsInt as any BinaryInteger
      ):
        return Int(lhsInt) < rhsInt;

    default:
      return false;
    };
  };
  
  func isLessThan<T: Comparable>(to other: T) -> Bool {
    return self < other;
  };
  
  func isGreaterThan<T: Comparable>(to other: T) -> Bool {
    return other < self;
  };
};
