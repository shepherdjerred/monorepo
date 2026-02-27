//
//  CGRect+ElementInterpolatable.swift
//
//
//  Created by Dominic Go on 7/16/24.
//

import Foundation
import CoreGraphics


extension CGRect: ElementInterpolatable {
  
  public struct InterpolatableElements: OptionSet, CompositeInterpolatableElements {
    public let rawValue: Int;
    
    public static let width  = Self(rawValue: 1 << 0);
    public static let height = Self(rawValue: 1 << 1);
    public static let x      = Self(rawValue: 1 << 2);
    public static let y      = Self(rawValue: 1 << 3);
    
    public static let size  : Self = [.width, .height];
    public static let origin: Self = [.x, .y];
    public static let none  : Self = [];
    
    public var associatedAnyKeyPaths: [AnyKeyPath] {
      guard !self.isEmpty else {
        return [];
      };
      
      var keyPaths: [AnyKeyPath] = [];
      
      if self.contains(.height) {
        keyPaths.append(\CGSize.height);
      };
      
      if self.contains(.width) {
        keyPaths.append(\CGSize.width);
      };
      
      if self.contains(.x) {
        keyPaths.append(\CGPoint.x);
      };
      
      if self.contains(.y) {
        keyPaths.append(\CGPoint.y);
      };
      
      return keyPaths;
    };
    
    public init(rawValue: Int) {
      self.rawValue = rawValue;
    };
  };

  public static var interpolatablePropertiesMap: InterpolatableValuesMap = [
    \.size: CGSize.self,
    \.origin: CGPoint.self,
  ];
};


