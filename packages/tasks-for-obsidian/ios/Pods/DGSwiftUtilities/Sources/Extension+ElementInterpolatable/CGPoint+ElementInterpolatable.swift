//
//  CGPoint+ElementInterpolatable.swift
//
//
//  Created by Dominic Go on 7/17/24.
//

import Foundation
import CoreGraphics


extension CGPoint: ElementInterpolatable {

  public struct InterpolatableElements: OptionSet, CompositeInterpolatableElements {
    public let rawValue: Int;
    
    public static let x = Self(rawValue: 1 << 2);
    public static let y = Self(rawValue: 1 << 3);
    
    public var associatedAnyKeyPaths: [AnyKeyPath] {
      guard !self.isEmpty else {
        return [];
      };
      
      var keyPaths: [PartialKeyPath<CGPoint>] = [];
      
      if self.contains(.x) {
        keyPaths.append(\.x);
      };
      
      if self.contains(.y) {
        keyPaths.append(\.y);
      };

      return keyPaths;
    };
    
    public init(rawValue: Int) {
      self.rawValue = rawValue;
    };
  };

  public static var interpolatablePropertiesMap: InterpolatableValuesMap = [
    \.x: CGFloat.self,
    \.y: CGFloat.self,
  ];
};
