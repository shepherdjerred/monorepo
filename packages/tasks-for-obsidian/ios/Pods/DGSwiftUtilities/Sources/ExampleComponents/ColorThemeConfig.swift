//
//  ColorThemeConfig.swift
//  ConfigBasedModalExample
//
//  Created by Dominic Go on 6/10/24.
//

import UIKit

public struct ColorThemeConfig {
  
  public static let presetPurple: Self = .init(
    colorBgLight: ColorPreset.purple100.color,
    colorBgDark: ColorPreset.purple600.color,
    colorBgAccent: ColorPreset.purpleA700.color,
    colorTextLight: .init(white: 1, alpha: 0.9),
    colorTextDark: {
      let rgba = ColorPreset.purple1000.color.rgba;
      return .init(
        red: rgba.r,
        green: rgba.g,
        blue: rgba.b,
        alpha: 0.8
      );
    }(),
    colorTextAccent: ColorPreset.purpleA700.color
  );

  // MARK: - Properties
  // ------------------
  
  public var colorBgLight: UIColor;
  public var colorBgDark: UIColor;
  public var colorBgAccent: UIColor;
  
  public var colorTextLight: UIColor;
  public var colorTextDark: UIColor;
  public var colorTextAccent: UIColor;
  
  // MARK: - Init
  // ------------
  
  public init(
    colorBgLight: UIColor,
    colorBgDark: UIColor,
    colorBgAccent: UIColor,
    colorTextLight: UIColor,
    colorTextDark: UIColor,
    colorTextAccent: UIColor
  ) {
    self.colorBgLight = colorBgLight;
    self.colorBgDark = colorBgDark;
    self.colorBgAccent = colorBgAccent;
    self.colorTextLight = colorTextLight;
    self.colorTextDark = colorTextDark;
    self.colorTextAccent = colorTextAccent;
  }
};
