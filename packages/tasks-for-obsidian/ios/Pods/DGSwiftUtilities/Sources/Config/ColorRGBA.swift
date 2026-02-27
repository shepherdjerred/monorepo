//
//  ColorRGBA.swift
//  
//
//  Created by Dominic Go on 10/23/23.
//

import UIKit


public struct ColorRGBA: Equatable {

  public var r: CGFloat;
  public var g: CGFloat;
  public var b: CGFloat;
  public var a: CGFloat;
  
  public var uiColor: UIColor {
    .init(red: self.r, green: self.g, blue: self.b, alpha: self.a);
  };
  
  public var cgColor: CGColor {
    if #available(iOS 13.0, *) {
      return .init(red: self.r, green: self.g, blue: self.b, alpha: self.a);
      
    } else {
      return self.uiColor.cgColor;
    };
  };
  
  public init(r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat = 1) {
    self.r = r;
    self.g = g;
    self.b = b;
    self.a = a;
  };
  
  public init(r: UInt8, g: UInt8, b: UInt8, a: CGFloat = 1) {
    self.r = CGFloat(r) / 255;
    self.g = CGFloat(g) / 255;
    self.b = CGFloat(b) / 255;
    
    self.a = a;
  };
  
  public init(r: Int, g: Int, b: Int, a: CGFloat = 1) {
    self.init(r: UInt8(r), g: UInt8(g), b: UInt8(b), a: a);
  };
};
