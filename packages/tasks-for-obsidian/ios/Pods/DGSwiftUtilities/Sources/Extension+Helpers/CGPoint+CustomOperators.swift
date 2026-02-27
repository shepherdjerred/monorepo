//
//  CGPoint+CustomOperators.swift
//  
//
//  Created by Dominic Go on 11/17/24.
//

import Foundation

public extension CGPoint {

  // MARK: - lhs + rhs == Self
  // -------------------------
  
  static func +(lhs: Self, rhs: Self) -> Self {
    return .init(
      x: lhs.x + rhs.x,
      y: lhs.y + rhs.y
    );
  };
  
  static func -(lhs: Self, rhs: Self) -> Self {
    return .init(
      x: lhs.x - rhs.x,
      y: lhs.y - rhs.y
    );
  };
  
  static func *(lhs: Self, rhs: Self) -> Self {
    return .init(
      x: lhs.x * rhs.x,
      y: lhs.y * rhs.y
    );
  };
  
  static func /(lhs: Self, rhs: Self) -> Self {
    return .init(
      x: lhs.x / rhs.x,
      y: lhs.y / rhs.y
    );
  };
  
  // MARK: - lhs = Self, rhs: CGFloat
  // --------------------------------
  
  static func +(lhs: Self, rhs: CGFloat) -> Self {
    return .init(
      x: lhs.x + rhs,
      y: lhs.y + rhs
    );
  };
  
  static func -(lhs: Self, rhs: CGFloat) -> Self {
    return .init(
      x: lhs.x - rhs,
      y: lhs.y - rhs
    );
  };
  
  static func *(lhs: Self, rhs: CGFloat) -> Self {
    return .init(
      x: lhs.x * rhs,
      y: lhs.y * rhs
    );
  };
  
  static func /(lhs: Self, rhs: CGFloat) -> Self {
    return .init(
      x: lhs.x / rhs,
      y: lhs.y / rhs
    );
  };
  
  // MARK: - lhs = Self, rhs: CGVector
  // ---------------------------------
  
  static func +(lhs: Self, rhs: CGVector) -> Self {
    return .init(
      x: lhs.x + rhs.dx,
      y: lhs.y + rhs.dy
    );
  };
  
  static func -(lhs: Self, rhs: CGVector) -> Self {
    return .init(
      x: lhs.x - rhs.dx,
      y: lhs.y - rhs.dy
    );
  };
  
  static func *(lhs: Self, rhs: CGVector) -> Self {
    return .init(
      x: lhs.x * rhs.dx,
      y: lhs.y * rhs.dy
    );
  };
  
  static func /(lhs: Self, rhs: CGVector) -> Self {
    return .init(
      x: lhs.x / rhs.dx,
      y: lhs.y / rhs.dy
    );
  };
};
