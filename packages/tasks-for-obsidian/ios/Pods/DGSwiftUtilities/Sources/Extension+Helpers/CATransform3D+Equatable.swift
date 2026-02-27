//
//  File.swift
//  
//
//  Created by Dominic Go on 8/7/23.
//

import QuartzCore

extension CATransform3D: Equatable {

  fileprivate static let keys: [KeyPath<Self, CGFloat>] = [
      \.m11, \.m12, \.m13, \.m14,
      \.m21, \.m22, \.m23, \.m24,
      \.m31, \.m32, \.m33, \.m34,
      \.m41, \.m42, \.m43, \.m44,
    ];

  public static func == (lhs: CATransform3D, rhs: CATransform3D) -> Bool {
    return Self.keys.allSatisfy {
      lhs[keyPath: $0] == rhs[keyPath: $0];
    };
  };
};
