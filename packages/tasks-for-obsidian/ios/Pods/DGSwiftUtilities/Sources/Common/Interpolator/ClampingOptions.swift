//
//  ClampingOptions.swift
//  
//
//  Created by Dominic Go on 7/20/24.
//

import Foundation


public struct ClampingOptions: OptionSet {
  public let rawValue: UInt8;
  
  public static let left = Self(rawValue: 1 << 0);
  public static let right = Self(rawValue: 1 << 1);
  
  public static let none: Self = [];
  public static let leftAndRight: Self = [.left, right];
  
  public var shouldClampLeft: Bool {
    self.contains(.left);
  };
  
  public var shouldClampRight: Bool {
    self.contains(.right);
  };
  
  public init(rawValue: UInt8) {
    self.rawValue = rawValue;
  };
};
