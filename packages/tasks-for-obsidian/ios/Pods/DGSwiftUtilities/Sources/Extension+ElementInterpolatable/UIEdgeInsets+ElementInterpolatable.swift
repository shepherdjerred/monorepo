//
//  UIEdgeInsets+ElementInterpolatable.swift
//  
//
//  Created by Dominic Go on 7/24/24.
//

import UIKit


extension UIEdgeInsets: ElementInterpolatable {
  
  public struct InterpolatableElements: OptionSet, CompositeInterpolatableElements {
    public let rawValue: Int;
    
    public static let top     = Self(rawValue: 1 << 0);
    public static let bottom  = Self(rawValue: 1 << 1);
    public static let left    = Self(rawValue: 1 << 2);
    public static let right   = Self(rawValue: 1 << 3);
    
    public static let horizontal: Self = [.left, .right];
    public static let vertical  : Self = [.top, .bottom];
    
    public var associatedAnyKeyPaths: [AnyKeyPath] {
      guard !self.isEmpty else {
        return [];
      };
      
      var keyPaths: [PartialKeyPath<InterpolatableValue>] = [];
      
      if self.contains(.top) {
        keyPaths.append(\.top);
      };
      
      if self.contains(.bottom) {
        keyPaths.append(\.bottom);
      };
      
      if self.contains(.left) {
        keyPaths.append(\.left);
      };
      
      if self.contains(.right) {
        keyPaths.append(\.right);
      };
      
      return keyPaths;
    };
    
    public init(rawValue: Int) {
      self.rawValue = rawValue;
    };
  };

  public static var interpolatablePropertiesMap: InterpolatableValuesMap = [
    \.top: CGFloat.self,
    \.bottom: CGFloat.self,
    \.left: CGFloat.self,
    \.right: CGFloat.self,
  ];
};


