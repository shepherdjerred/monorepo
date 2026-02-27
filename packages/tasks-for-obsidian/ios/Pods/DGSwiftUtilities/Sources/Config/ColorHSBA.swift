//
//  ColorHSBA.swift
//  
//
//  Created by Dominic Go on 7/24/24.
//

import UIKit


public struct ColorHSBA: Equatable {

  public var h: CGFloat;
  public var s: CGFloat;
  public var b: CGFloat;
  public var a: CGFloat;
  
  public var uiColor: UIColor {
    .init(hue: self.h, saturation: self.h, brightness: self.b, alpha: self.a);
  };
  
  public var cgColor: CGColor {
    return self.uiColor.cgColor;
  };
  
  public init(h: CGFloat, s: CGFloat, b: CGFloat, a: CGFloat = 1) {
    self.h = h;
    self.s = s;
    self.b = b;
    self.a = a;
  };
  
  public init(h: UInt8, s: UInt8, b: UInt8, a: CGFloat = 1) {
    self.h = CGFloat(h) / 255;
    self.s = CGFloat(s) / 255;
    self.b = CGFloat(b) / 255;
    
    self.a = a;
  };
  
  public init(h: Int, s: Int, b: Int, a: CGFloat = 1) {
    self.init(h: UInt8(h), s: UInt8(s), b: UInt8(b), a: a);
  };
};
