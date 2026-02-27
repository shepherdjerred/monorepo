//
//  CGVector+CustomOperators.swift
//  
//
//  Created by Dominic Go on 11/21/24.
//

import Foundation


public extension CGVector {

  // MARK: - lhs + rhs == Self
  // -------------------------
  
  static func +(lhs: Self, rhs: Self) -> Self {
    return .init(
      dx: lhs.dx + rhs.dx,
      dy: lhs.dy + rhs.dy
    );
  };
  
  static func -(lhs: Self, rhs: Self) -> Self {
    return .init(
      dx: lhs.dx - rhs.dx,
      dy: lhs.dy - rhs.dy
    );
  };
  
  static func *(lhs: Self, rhs: Self) -> Self {
    return .init(
      dx: lhs.dx * rhs.dx,
      dy: lhs.dy * rhs.dy
    );
  };
  
  static func /(lhs: Self, rhs: Self) -> Self {
    return .init(
      dx: lhs.dx / rhs.dx,
      dy: lhs.dy / rhs.dy
    );
  };
  
  // MARK: - lhs = Self, rhs: CGFloat
  // --------------------------------
  
  static func +(lhs: Self, rhs: CGFloat) -> Self {
    return .init(
      dx: lhs.dx + rhs,
      dy: lhs.dy + rhs
    );
  };
  
  static func -(lhs: Self, rhs: CGFloat) -> Self {
    return .init(
      dx: lhs.dx - rhs,
      dy: lhs.dy - rhs
    );
  };
  
  static func *(lhs: Self, rhs: CGFloat) -> Self {
    return .init(
      dx: lhs.dx * rhs,
      dy: lhs.dy * rhs
    );
  };
  
  static func /(lhs: Self, rhs: CGFloat) -> Self {
    return .init(
      dx: lhs.dx / rhs,
      dy: lhs.dy / rhs
    );
  };
  
  // MARK: - lhs = Self, rhs: CGVector
  // ---------------------------------
  
  static func +(lhs: Self, rhs: CGPoint) -> Self {
    return .init(
      dx: lhs.dx + rhs.x,
      dy: lhs.dy + rhs.y
    );
  };
  
  static func -(lhs: Self, rhs: CGPoint) -> Self {
    return .init(
      dx: lhs.dx - rhs.x,
      dy: lhs.dy - rhs.y
    );
  };
  
  static func *(lhs: Self, rhs: CGPoint) -> Self {
    return .init(
      dx: lhs.dx * rhs.x,
      dy: lhs.dy * rhs.y
    );
  };
  
  static func /(lhs: Self, rhs: CGPoint) -> Self {
    return .init(
      dx: lhs.dx / rhs.x,
      dy: lhs.dy / rhs.y
    );
  };
};
