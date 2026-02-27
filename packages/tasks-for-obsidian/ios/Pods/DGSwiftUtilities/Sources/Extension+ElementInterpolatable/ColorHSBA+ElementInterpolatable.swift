//
//  ColorHSBA+UniformInterpolatable.swift
//  
//
//  Created by Dominic Go on 7/24/24.
//

import Foundation

extension ColorHSBA: ElementInterpolatable {

  public struct InterpolatableElements: OptionSet, CompositeInterpolatableElements {
    public let rawValue: Int;
    
    public static let h = Self(rawValue: 1 << 0);
    public static let s = Self(rawValue: 1 << 1);
    public static let b = Self(rawValue: 1 << 2);
    public static let a = Self(rawValue: 1 << 3);
    
    public var associatedAnyKeyPaths: [AnyKeyPath] {
      guard !self.isEmpty else {
        return [];
      };
      
      var keyPaths: [PartialKeyPath<ColorHSBA>] = [];
      
      if self.contains(.h) {
        keyPaths.append(\.h);
      };
      
      if self.contains(.s) {
        keyPaths.append(\.s);
      };
      
      if self.contains(.b) {
        keyPaths.append(\.b);
      };
      
      if self.contains(.a) {
        keyPaths.append(\.a);
      };
      
      return keyPaths;
    };
    
    public init(rawValue: Int) {
      self.rawValue = rawValue;
    };
  };
  
  public static var interpolatablePropertiesMap: InterpolatableValuesMap = [
    \.h: CGFloat.self,
    \.s: CGFloat.self,
    \.b: CGFloat.self,
    \.a: CGFloat.self,
  ];
  
  public init() {
    self.init(h: 0, s: 0, b: 0);
  };
};
