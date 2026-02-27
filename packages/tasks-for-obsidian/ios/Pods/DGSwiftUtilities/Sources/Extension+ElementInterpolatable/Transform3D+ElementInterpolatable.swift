//
//  Transform3D+ElementInterpolatable.swift
//  
//
//  Created by Dominic Go on 7/24/24.
//

import Foundation


extension Transform3D: ElementInterpolatable {
  
  public struct InterpolatableElements: OptionSet, CompositeInterpolatableElements {
    public let rawValue: Int;
    
    public static let translateX  = Self(rawValue: 1 << 0 );
    public static let translateY  = Self(rawValue: 1 << 1 );
    public static let translateZ  = Self(rawValue: 1 << 2 );
    public static let scaleX      = Self(rawValue: 1 << 3 );
    public static let scaleY      = Self(rawValue: 1 << 4 );
    public static let rotateX     = Self(rawValue: 1 << 5 );
    public static let rotateY     = Self(rawValue: 1 << 6 );
    public static let rotateZ     = Self(rawValue: 1 << 7 );
    public static let perspective = Self(rawValue: 1 << 8 );
    public static let skewX       = Self(rawValue: 1 << 9 );
    public static let skewY       = Self(rawValue: 1 << 10);
    
    public static let translate2D: Self = [.translateX, .translateY];
    public static let translate3D: Self = [.translateX, .translateY, .translateZ];
    
    public static let scale: Self = [.scaleX, .scaleY];
    
    public static let rotate2D: Self = [.rotateX, .rotateY];
    public static let rotate3D: Self = [.rotateX, .rotateY, .rotateZ];
    
    public static let skew: Self = [.skewX, .skewY];
    
    public var associatedAnyKeyPaths: [AnyKeyPath] {
      guard !self.isEmpty else {
        return [];
      };
      
      var keyPaths: [PartialKeyPath<InterpolatableValue>] = [];
      
      if self.contains(.translateX) {
        keyPaths.append(\.translateX);
      };
      
      if self.contains(.translateY) {
        keyPaths.append(\.translateY);
      };
      
      if self.contains(.translateZ) {
        keyPaths.append(\.translateZ);
      };
      
      if self.contains(.scaleX) {
        keyPaths.append(\.scaleX);
      };
      
      if self.contains(.scaleY) {
        keyPaths.append(\.scaleY);
      };
      
      if self.contains(.rotateX) {
        keyPaths.append(\.rotateX);
      };
      
      if self.contains(.rotateY) {
        keyPaths.append(\.rotateY);
      };
      
      if self.contains(.rotateZ) {
        keyPaths.append(\.rotateZ);
      };
      
      if self.contains(.perspective) {
        keyPaths.append(\.perspective);
      };
      
      if self.contains(.skewX) {
        keyPaths.append(\.skewX);
      };
      
      if self.contains(.skewY) {
        keyPaths.append(\.skewY);
      };
      
      return keyPaths;
    };
    
    public init(rawValue: Int) {
      self.rawValue = rawValue;
    };
  };
  
  public static var interpolatablePropertiesMap: InterpolatableValuesMap = [
    \.translateX: CGFloat.self,
    \.translateY: CGFloat.self,
    \.translateZ: CGFloat.self,
    \.scaleX: CGFloat.self,
    \.scaleY: CGFloat.self,
    \.rotateX: Angle<CGFloat>.self,
    \.rotateY: Angle<CGFloat>.self,
    \.rotateZ: Angle<CGFloat>.self,
    \.perspective: CGFloat.self,
    \.skewX: CGFloat.self,
    \.skewY: CGFloat.self,
  ];
  
  public init() {
    self = .identity;
  };
};
